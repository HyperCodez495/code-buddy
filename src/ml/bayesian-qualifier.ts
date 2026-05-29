import { Matrix, CholeskyDecomposition } from 'ml-matrix';
import { logger } from '../utils/logger.js';

export interface BayesianState {
  X: number[][];
  y: number[];
  means: number[];
  stds: number[];
  lengthScale: number;
  signalVariance: number;
  noiseVariance: number;
}

export class StandardScaler {
  public means: number[] = [];
  public stds: number[] = [];

  fit(X: number[][]): void {
    if (X.length === 0) return;
    const firstRow = X[0];
    if (firstRow === undefined) return;
    const numFeatures = firstRow.length;
    this.means = Array(numFeatures).fill(0);
    this.stds = Array(numFeatures).fill(0);

    for (let j = 0; j < numFeatures; j++) {
      let sum = 0;
      for (const row of X) {
        sum += row[j] ?? 0;
      }
      const mean = sum / X.length;
      this.means[j] = mean;

      let varianceSum = 0;
      for (const row of X) {
        varianceSum += Math.pow((row[j] ?? 0) - mean, 2);
      }
      this.stds[j] = Math.sqrt(varianceSum / X.length) || 1e-8;
    }
  }

  transform(X: number[][]): number[][] {
    if (this.means.length === 0) return X;
    return X.map(row => row.map((val, j) => (val - (this.means[j] ?? 0)) / (this.stds[j] ?? 1e-8)));
  }

  transformVector(x: number[]): number[] {
    if (this.means.length === 0) return x;
    return x.map((val, j) => (val - (this.means[j] ?? 0)) / (this.stds[j] ?? 1e-8));
  }
}

export class BayesianQualifier {
  private X: number[][] = [];
  private y: number[] = [];
  private scaler = new StandardScaler();
  private isTrained = false;

  // Hyperparameters
  private lengthScale = 1.0;
  private signalVariance = 1.0;
  private noiseVariance = 1e-4;

  // GPR internal variables
  private XScaled: number[][] = [];
  private L: Matrix | null = null; // Lower triangular Cholesky decomposition of Covariance matrix
  private alpha: Matrix | null = null; // K^-1 * y

  constructor(options: {
    lengthScale?: number;
    signalVariance?: number;
    noiseVariance?: number;
  } = {}) {
    if (options.lengthScale !== undefined) this.lengthScale = options.lengthScale;
    if (options.signalVariance !== undefined) this.signalVariance = options.signalVariance;
    if (options.noiseVariance !== undefined) this.noiseVariance = options.noiseVariance;
  }

  /**
   * Add a training sample (features vector + binary label 0 or 1)
   */
  addSample(features: number[], label: number): void {
    this.X.push(features);
    this.y.push(label);
    this.isTrained = false;
  }

  /**
   * Train the GPR model
   */
  train(): void {
    if (this.X.length === 0) {
      logger.warn('[BayesianQualifier] Cannot train model with 0 samples.');
      return;
    }

    // 1. Fit & transform features
    this.scaler.fit(this.X);
    this.XScaled = this.scaler.transform(this.X);

    const N = this.X.length;

    // 2. Compute Covariance Matrix K
    const K = new Matrix(N, N);
    for (let i = 0; i < N; i++) {
      const rowI = this.XScaled[i];
      if (rowI === undefined) continue;
      for (let j = 0; j < N; j++) {
        const rowJ = this.XScaled[j];
        if (rowJ === undefined) continue;
        let cov = this.rbfKernel(rowI, rowJ);
        if (i === j) {
          cov += this.noiseVariance;
        }
        K.set(i, j, cov);
      }
    }

    // 3. Cholesky Decomposition
    try {
      const cholesky = new CholeskyDecomposition(K);
      this.L = cholesky.lowerTriangularMatrix;

      const yMatrix = Matrix.columnVector(this.y);
      // Solve L * L^T * alpha = y
      // First solve L * z = y, then L^T * alpha = z
      const z = this.forwardSubstitute(this.L, yMatrix);
      const LT = this.L.transpose();
      this.alpha = this.backwardSubstitute(LT, z);

      this.isTrained = true;
    } catch (err: any) {
      logger.error(`[BayesianQualifier] Cholesky decomposition failed: ${err.message}. Adding extra jitter...`);
      // Add extra regularizer to diagonal and try again
      const KReg = K.add(Matrix.eye(N).mul(1e-3));
      try {
        const cholesky = new CholeskyDecomposition(KReg);
        this.L = cholesky.lowerTriangularMatrix;
        const yMatrix = Matrix.columnVector(this.y);
        const z = this.forwardSubstitute(this.L, yMatrix);
        const LT = this.L.transpose();
        this.alpha = this.backwardSubstitute(LT, z);
        this.isTrained = true;
      } catch (finalErr: any) {
        logger.error(`[BayesianQualifier] Model training failed completely: ${finalErr.message}`);
        this.isTrained = false;
      }
    }
  }

  /**
   * Predict mean and standard deviation for a features vector
   */
  predict(features: number[]): { mean: number; std: number } {
    if (!this.isTrained || this.X.length === 0 || !this.L || !this.alpha) {
      // Return default uninformative prior if not trained
      return { mean: 0.5, std: 1.0 };
    }

    const xStar = this.scaler.transformVector(features);
    const N = this.X.length;

    // Compute kStar vector
    const kStar = new Matrix(N, 1);
    for (let i = 0; i < N; i++) {
      const rowI = this.XScaled[i];
      if (rowI === undefined) continue;
      kStar.set(i, 0, this.rbfKernel(xStar, rowI));
    }

    // mean = kStar^T * alpha
    const mean = kStar.transpose().mmul(this.alpha).get(0, 0);

    // v = L^-1 * kStar
    const v = this.forwardSubstitute(this.L, kStar);

    // var = k(x*, x*) - v^T * v
    const kStarStar = this.signalVariance + this.noiseVariance;
    const vTransposedV = v.transpose().mmul(v).get(0, 0);
    const variance = Math.max(1e-8, kStarStar - vTransposedV);
    const std = Math.sqrt(variance);

    return { mean, std };
  }

  /**
   * Compute BALD (Bayesian Active Learning by Disagreement) score
   */
  getAcquisitionScore(features: number[]): number {
    const { mean, std } = this.predict(features);

    // Sigmoid mapping to probability
    const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

    // Scaled mean to compute predictive entropy
    const kappa = 1 / Math.sqrt(1 + (Math.PI * std * std) / 8);
    const p = sigmoid(mean * kappa);
    const entropy = -p * Math.log2(p + 1e-8) - (1 - p) * Math.log2(1 - p + 1e-8);

    // Expected entropy
    const expectedEntropy = kappa * (-sigmoid(mean) * Math.log2(sigmoid(mean) + 1e-8) - (1 - sigmoid(mean)) * Math.log2(1 - sigmoid(mean) + 1e-8));

    // BALD Score = Mutual Information
    return Math.max(0, entropy - expectedEntropy);
  }

  /**
   * Save the qualifier state to a JSON string
   */
  saveState(): string {
    const state: BayesianState = {
      X: this.X,
      y: this.y,
      means: this.scaler.means,
      stds: this.scaler.stds,
      lengthScale: this.lengthScale,
      signalVariance: this.signalVariance,
      noiseVariance: this.noiseVariance,
    };
    return JSON.stringify(state);
  }

  /**
   * Load the qualifier state from a JSON string
   */
  loadState(stateJson: string): void {
    try {
      const state: BayesianState = JSON.parse(stateJson);
      this.X = state.X;
      this.y = state.y;
      this.scaler.means = state.means;
      this.scaler.stds = state.stds;
      this.lengthScale = state.lengthScale;
      this.signalVariance = state.signalVariance;
      this.noiseVariance = state.noiseVariance;

      if (this.X.length > 0) {
        this.train();
      }
    } catch (err: any) {
      logger.error(`[BayesianQualifier] Failed to load state: ${err.message}`);
    }
  }

  // ============================================================================
  // Math Helpers
  // ============================================================================

  private rbfKernel(x1: number[], x2: number[]): number {
    let sumSqDiff = 0;
    for (let i = 0; i < x1.length; i++) {
      sumSqDiff += Math.pow((x1[i] ?? 0) - (x2[i] ?? 0), 2);
    }
    return this.signalVariance * Math.exp(-sumSqDiff / (2 * this.lengthScale * this.lengthScale));
  }

  /**
   * Solve L * x = b for lower triangular matrix L
   */
  private forwardSubstitute(L: Matrix, b: Matrix): Matrix {
    const N = L.rows;
    const x = new Matrix(N, 1);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < i; j++) {
        sum += L.get(i, j) * x.get(j, 0);
      }
      x.set(i, 0, (b.get(i, 0) - sum) / L.get(i, i));
    }
    return x;
  }

  /**
   * Solve U * x = b for upper triangular matrix U
   */
  private backwardSubstitute(U: Matrix, b: Matrix): Matrix {
    const N = U.rows;
    const x = new Matrix(N, 1);
    for (let i = N - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < N; j++) {
        sum += U.get(i, j) * x.get(j, 0);
      }
      x.set(i, 0, (b.get(i, 0) - sum) / U.get(i, i));
    }
    return x;
  }
}
