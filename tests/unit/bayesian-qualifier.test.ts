import { describe, it, expect } from 'vitest';
import { BayesianQualifier, StandardScaler } from '../../src/ml/bayesian-qualifier.js';

describe('StandardScaler', () => {
  it('should scale features to zero mean and unit variance', () => {
    const scaler = new StandardScaler();
    const data = [
      [1.0, 10.0],
      [2.0, 20.0],
      [3.0, 30.0],
    ];

    scaler.fit(data);
    expect(scaler.means).toEqual([2.0, 20.0]);
    expect(scaler.stds[0]).toBeCloseTo(0.81649, 4);

    const transformed = scaler.transform(data);
    expect(transformed[0][0]).toBeCloseTo(-1.2247, 4);
    expect(transformed[1][0]).toBeCloseTo(0.0, 4);
    expect(transformed[2][0]).toBeCloseTo(1.2247, 4);
  });
});

describe('BayesianQualifier', () => {
  it('should train GPR and predict scores based on similarity', () => {
    const model = new BayesianQualifier({
      lengthScale: 1.0,
      noiseVariance: 1e-4,
    });

    // 0: irrelevant, 1: relevant
    model.addSample([1.0, 1.0], 1);
    model.addSample([10.0, 10.0], 0);

    model.train();

    // Predictions close to [1.0, 1.0] should be close to 1
    const p1 = model.predict([1.1, 1.1]);
    expect(p1.mean).toBeGreaterThan(0.8);

    // Predictions close to [10.0, 10.0] should be close to 0
    const p2 = model.predict([9.9, 9.9]);
    expect(p2.mean).toBeLessThan(0.2);
  });

  it('should compute active learning acquisition score (BALD)', () => {
    const model = new BayesianQualifier({
      lengthScale: 1.0,
    });

    model.addSample([1.0, 1.0], 1);
    model.addSample([10.0, 10.0], 0);
    model.train();

    // Querying a point far from either sample should yield higher uncertainty and a positive BALD score
    const pUncertain = model.predict([5.0, 5.0]);
    const scoreUncertain = model.getAcquisitionScore([5.0, 5.0]);

    // Querying a point close to a known sample should yield lower uncertainty and lower BALD score
    const pCertain = model.predict([1.0, 1.0]);
    const scoreCertain = model.getAcquisitionScore([1.0, 1.0]);

    expect(pUncertain.std).toBeGreaterThan(pCertain.std);
    expect(scoreUncertain).toBeGreaterThan(scoreCertain);
  });

  it('should save and load state correctly', () => {
    const model = new BayesianQualifier();
    model.addSample([1.0, 2.0], 1);
    model.addSample([3.0, 4.0], 0);
    model.train();

    const state = model.saveState();

    const newModel = new BayesianQualifier();
    newModel.loadState(state);

    const pOriginal = model.predict([1.5, 2.5]);
    const pLoaded = newModel.predict([1.5, 2.5]);

    expect(pLoaded.mean).toBeCloseTo(pOriginal.mean, 5);
    expect(pLoaded.std).toBeCloseTo(pOriginal.std, 5);
  });

  it('should ignore empty, truncated, or invalid persisted state', () => {
    const model = new BayesianQualifier();

    expect(model.loadState('')).toBe(false);
    expect(model.loadState('{')).toBe(false);
    expect(model.loadState('{"X":[],"y":[]}')).toBe(false);

    const prediction = model.predict([1.0, 2.0]);
    expect(prediction.mean).toBe(0.5);
  });
});
