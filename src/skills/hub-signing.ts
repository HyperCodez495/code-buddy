/**
 * Skills Hub — signing & publisher trust
 *
 * Ed25519 detached signatures for skill registry metadata. SHA-256 checksums
 * already prove a SKILL.md was not corrupted in transit; signatures prove it was
 * authored by a holder of a trusted publisher key. Together they close the
 * "signed registry metadata" gap before community-wide third-party installs.
 *
 * This module is pure: no filesystem, no network, no clock dependency beyond the
 * caller-supplied `signedAt`. Key persistence (the trusted-key ring) lives on
 * {@link SkillsHub}, which consumes {@link resolveSignatureVerification}.
 *
 * Uses only Node's built-in `crypto` — no new dependency.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';

export type SkillSignatureAlgorithm = 'ed25519';

/** Trust levels mirror the tap trust ladder so operators reason about one model. */
export type SkillKeyTrust = 'builtin' | 'official' | 'trusted' | 'community';

export interface SkillSignature {
  /** Signature scheme. Only ed25519 is supported today. */
  algorithm: SkillSignatureAlgorithm;
  /** Stable signer key id (sha256 fingerprint prefix of the public key). */
  keyId: string;
  /** Base64 SPKI DER public key of the signer. */
  publicKey: string;
  /** Base64 Ed25519 signature over the UTF-8 SKILL.md content. */
  signature: string;
  /** SHA-256 hex digest of the content this signature covers. */
  contentChecksum: string;
  /** ISO 8601 timestamp recorded when the content was signed. */
  signedAt: string;
}

/**
 * - `unsigned`: no signature was attached.
 * - `verified`: signature is cryptographically valid and the signer key is trusted.
 * - `untrusted`: signature is valid but the signer key is unknown to the keyring.
 * - `invalid`: signature is malformed, fails verification, the content changed,
 *   or the signer impersonates a trusted key id with a different public key.
 */
export type SkillSignatureStatus = 'unsigned' | 'verified' | 'untrusted' | 'invalid';

export interface SkillSignatureVerification {
  status: SkillSignatureStatus;
  keyId?: string;
  trust?: SkillKeyTrust;
  reason?: string;
}

export interface TrustedSkillKey {
  keyId: string;
  /** Base64 SPKI DER public key. */
  publicKey: string;
  algorithm: SkillSignatureAlgorithm;
  trust: SkillKeyTrust;
  /** First time this key was added (epoch ms). */
  addedAt: number;
  /** Last local metadata update (epoch ms). */
  updatedAt: number;
  /** Optional reviewer/operator who approved trusting the key. */
  addedBy?: string;
  /** Optional human-readable label for the publisher. */
  label?: string;
}

export interface SkillSigningKeyPair {
  keyId: string;
  /** Base64 SPKI DER public key (safe to publish). */
  publicKey: string;
  /** Base64 PKCS8 DER private key (keep secret). */
  privateKey: string;
}

export interface SignSkillOptions {
  keyId?: string;
  signedAt?: string;
}

export interface SignatureMathResult {
  checksumMatch: boolean;
  mathValid: boolean;
}

const TRUST_RANK: Record<SkillKeyTrust, number> = {
  community: 0,
  trusted: 1,
  official: 2,
  builtin: 3,
};

const SIGNATURE_TRUST_VALUES: readonly SkillKeyTrust[] = ['builtin', 'official', 'trusted', 'community'];

export function isSkillKeyTrust(value: unknown): value is SkillKeyTrust {
  return typeof value === 'string' && (SIGNATURE_TRUST_VALUES as readonly string[]).includes(value);
}

/** True when `trust` is at least as trusted as `min` on the trust ladder. */
export function meetsTrust(trust: SkillKeyTrust, min: SkillKeyTrust): boolean {
  return TRUST_RANK[trust] >= TRUST_RANK[min];
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Deterministic key id: first 16 hex chars of sha256(public key DER bytes). */
export function computeKeyId(publicKeyB64: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyB64, 'base64'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Validate that a base64 string really is an Ed25519 SPKI DER public key, then
 * return its deterministic key id. Throws with a clear message otherwise — used
 * before a key is admitted to the trusted keyring.
 */
export function validateEd25519PublicKey(publicKeyB64: string): string {
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeyB64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch (err) {
    throw new Error(
      `Invalid Ed25519 public key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `Unsupported public key type '${publicKey.asymmetricKeyType ?? 'unknown'}'. Expected ed25519.`,
    );
  }
  return computeKeyId(publicKeyB64);
}

/**
 * Generate a fresh Ed25519 publisher keypair. The public key is safe to share
 * and add to a consumer's trusted keyring; the private key signs SKILL.md
 * content and must stay secret.
 */
export function generateSkillSigningKeyPair(keyId?: string): SkillSigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const privateKeyB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const trimmedKeyId = keyId?.trim();
  return {
    keyId: trimmedKeyId && trimmedKeyId.length > 0 ? trimmedKeyId : computeKeyId(publicKeyB64),
    publicKey: publicKeyB64,
    privateKey: privateKeyB64,
  };
}

/**
 * Sign SKILL.md content with a base64 PKCS8 DER Ed25519 private key, producing a
 * detached {@link SkillSignature} that binds the content checksum.
 */
export function signSkillContent(
  content: string,
  privateKeyB64: string,
  options: SignSkillOptions = {},
): SkillSignature {
  let privateKey;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(privateKeyB64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch (err) {
    throw new Error(
      `Invalid Ed25519 signing key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `Unsupported signing key type '${privateKey.asymmetricKeyType ?? 'unknown'}'. Expected ed25519.`,
    );
  }

  const publicKeyB64 = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  const signature = cryptoSign(null, Buffer.from(content, 'utf-8'), privateKey).toString('base64');
  const trimmedKeyId = options.keyId?.trim();

  return {
    algorithm: 'ed25519',
    keyId: trimmedKeyId && trimmedKeyId.length > 0 ? trimmedKeyId : computeKeyId(publicKeyB64),
    publicKey: publicKeyB64,
    signature,
    contentChecksum: sha256Hex(content),
    signedAt: options.signedAt ?? new Date().toISOString(),
  };
}

/**
 * Low-level check: does the content still hash to the signed checksum, and does
 * the Ed25519 signature verify against the signature's own public key? This does
 * not consult any trust ring — see {@link resolveSignatureVerification}.
 */
export function verifySkillSignatureMath(content: string, signature: SkillSignature): SignatureMathResult {
  const checksumMatch = sha256Hex(content) === signature.contentChecksum;
  let mathValid = false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(signature.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (publicKey.asymmetricKeyType === 'ed25519') {
      mathValid = cryptoVerify(
        null,
        Buffer.from(content, 'utf-8'),
        publicKey,
        Buffer.from(signature.signature, 'base64'),
      );
    }
  } catch {
    mathValid = false;
  }
  return { checksumMatch, mathValid };
}

/**
 * Resolve the full {@link SkillSignatureVerification} for content against a set
 * of trusted keys. Pure: callers supply the keyring snapshot.
 *
 * Trust resolution order:
 *  1. no signature -> `unsigned`
 *  2. wrong algorithm / checksum mismatch / bad signature -> `invalid`
 *  3. valid signature, signer key id absent from ring -> `untrusted`
 *  4. valid signature, key id present but public key differs -> `invalid`
 *     (impersonation: an attacker reuses a trusted key id with their own key)
 *  5. valid signature, key id + public key match a trusted key -> `verified`
 */
export function resolveSignatureVerification(
  content: string,
  signature: SkillSignature | undefined,
  trustedKeys: TrustedSkillKey[] = [],
): SkillSignatureVerification {
  if (!signature) {
    return { status: 'unsigned' };
  }
  if (signature.algorithm !== 'ed25519') {
    return {
      status: 'invalid',
      keyId: signature.keyId,
      reason: `Unsupported signature algorithm '${signature.algorithm}'`,
    };
  }

  const { checksumMatch, mathValid } = verifySkillSignatureMath(content, signature);
  if (!checksumMatch) {
    return {
      status: 'invalid',
      keyId: signature.keyId,
      reason: 'Content checksum does not match the signed checksum',
    };
  }
  if (!mathValid) {
    return {
      status: 'invalid',
      keyId: signature.keyId,
      reason: 'Signature failed cryptographic verification',
    };
  }

  const trusted = trustedKeys.find((key) => key.keyId === signature.keyId);
  if (!trusted) {
    return {
      status: 'untrusted',
      keyId: signature.keyId,
      reason: 'Signer key is not in the trusted keyring',
    };
  }
  if (trusted.publicKey !== signature.publicKey) {
    return {
      status: 'invalid',
      keyId: signature.keyId,
      reason: 'Signer public key does not match the trusted key on record (possible key impersonation)',
    };
  }

  return { status: 'verified', keyId: signature.keyId, trust: trusted.trust };
}
