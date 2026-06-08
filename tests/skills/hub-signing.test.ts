/**
 * Tests for the Skills Hub signing & publisher-trust primitives.
 *
 * Covers Ed25519 keypair generation, detached content signing, low-level math
 * verification, full trust resolution (verified / untrusted / invalid /
 * unsigned), key-impersonation detection, and the trust ladder.
 */

import { generateKeyPairSync } from 'crypto';

import {
  generateSkillSigningKeyPair,
  signSkillContent,
  verifySkillSignatureMath,
  resolveSignatureVerification,
  computeKeyId,
  validateEd25519PublicKey,
  meetsTrust,
  isSkillKeyTrust,
  type SkillSignature,
  type TrustedSkillKey,
} from '../../src/skills/hub-signing';

const SKILL_CONTENT = `---
name: signed-skill
version: 1.0.0
description: A skill signed for authenticity tests
author: publisher
---

# Signed Skill

Body content.
`;

function trustedKey(
  keyId: string,
  publicKey: string,
  trust: TrustedSkillKey['trust'] = 'trusted',
): TrustedSkillKey {
  return {
    keyId,
    publicKey,
    algorithm: 'ed25519',
    trust,
    addedAt: 1,
    updatedAt: 1,
  };
}

describe('hub-signing', () => {
  describe('generateSkillSigningKeyPair', () => {
    it('produces base64 keys with a deterministic fingerprint key id', () => {
      const kp = generateSkillSigningKeyPair();
      expect(kp.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(kp.privateKey).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(kp.keyId).toBe(computeKeyId(kp.publicKey));
      expect(kp.keyId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('honors an explicit key id', () => {
      const kp = generateSkillSigningKeyPair('acme-prod');
      expect(kp.keyId).toBe('acme-prod');
    });

    it('produces distinct keypairs each call', () => {
      const a = generateSkillSigningKeyPair();
      const b = generateSkillSigningKeyPair();
      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.privateKey).not.toBe(b.privateKey);
      expect(a.keyId).not.toBe(b.keyId);
    });
  });

  describe('signSkillContent', () => {
    it('signs content and binds the checksum, key id, and timestamp', () => {
      const kp = generateSkillSigningKeyPair('acme');
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey, {
        keyId: 'acme',
        signedAt: '2026-06-07T00:00:00.000Z',
      });
      expect(sig.algorithm).toBe('ed25519');
      expect(sig.keyId).toBe('acme');
      expect(sig.publicKey).toBe(kp.publicKey);
      expect(sig.signedAt).toBe('2026-06-07T00:00:00.000Z');
      expect(sig.contentChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(sig.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('derives the key id from the public key when none is given', () => {
      const kp = generateSkillSigningKeyPair();
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey);
      expect(sig.keyId).toBe(computeKeyId(kp.publicKey));
    });

    it('throws on an invalid private key', () => {
      expect(() => signSkillContent(SKILL_CONTENT, 'not-a-real-key')).toThrow(/Invalid Ed25519 signing key/);
    });
  });

  describe('verifySkillSignatureMath', () => {
    it('reports checksumMatch and mathValid for untampered content', () => {
      const kp = generateSkillSigningKeyPair();
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey);
      const result = verifySkillSignatureMath(SKILL_CONTENT, sig);
      expect(result).toEqual({ checksumMatch: true, mathValid: true });
    });

    it('detects content changes via the checksum', () => {
      const kp = generateSkillSigningKeyPair();
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey);
      const result = verifySkillSignatureMath(SKILL_CONTENT + '\nmalicious', sig);
      expect(result.checksumMatch).toBe(false);
      expect(result.mathValid).toBe(false);
    });

    it('detects a corrupted signature', () => {
      const kp = generateSkillSigningKeyPair();
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey);
      const tampered: SkillSignature = { ...sig, signature: Buffer.from('garbage').toString('base64') };
      const result = verifySkillSignatureMath(SKILL_CONTENT, tampered);
      expect(result.mathValid).toBe(false);
    });
  });

  describe('resolveSignatureVerification', () => {
    it('returns unsigned when there is no signature', () => {
      expect(resolveSignatureVerification(SKILL_CONTENT, undefined, [])).toEqual({ status: 'unsigned' });
    });

    it('returns verified when the signer key is trusted and matches', () => {
      const kp = generateSkillSigningKeyPair('acme');
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey, { keyId: 'acme' });
      const verdict = resolveSignatureVerification(SKILL_CONTENT, sig, [
        trustedKey('acme', kp.publicKey, 'official'),
      ]);
      expect(verdict.status).toBe('verified');
      expect(verdict.keyId).toBe('acme');
      expect(verdict.trust).toBe('official');
    });

    it('returns untrusted when the signer key is unknown', () => {
      const kp = generateSkillSigningKeyPair('acme');
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey, { keyId: 'acme' });
      const verdict = resolveSignatureVerification(SKILL_CONTENT, sig, []);
      expect(verdict.status).toBe('untrusted');
      expect(verdict.keyId).toBe('acme');
    });

    it('returns invalid when content was tampered with after signing', () => {
      const kp = generateSkillSigningKeyPair('acme');
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey, { keyId: 'acme' });
      const verdict = resolveSignatureVerification(SKILL_CONTENT + '\nx', sig, [
        trustedKey('acme', kp.publicKey),
      ]);
      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toMatch(/checksum/i);
    });

    it('detects key-id impersonation (trusted id, attacker public key)', () => {
      const honest = generateSkillSigningKeyPair('acme');
      const attacker = generateSkillSigningKeyPair();
      // Attacker signs with their own key but claims the trusted "acme" key id.
      const forged = signSkillContent(SKILL_CONTENT, attacker.privateKey, { keyId: 'acme' });
      const verdict = resolveSignatureVerification(SKILL_CONTENT, forged, [
        trustedKey('acme', honest.publicKey),
      ]);
      expect(verdict.status).toBe('invalid');
      expect(verdict.reason).toMatch(/impersonation/i);
    });

    it('returns invalid for an unsupported algorithm', () => {
      const kp = generateSkillSigningKeyPair('acme');
      const sig = signSkillContent(SKILL_CONTENT, kp.privateKey, { keyId: 'acme' });
      const wrongAlgo = { ...sig, algorithm: 'rsa' as unknown as SkillSignature['algorithm'] };
      const verdict = resolveSignatureVerification(SKILL_CONTENT, wrongAlgo, [
        trustedKey('acme', kp.publicKey),
      ]);
      expect(verdict.status).toBe('invalid');
    });
  });

  describe('validateEd25519PublicKey', () => {
    it('returns the key id for a valid Ed25519 public key', () => {
      const kp = generateSkillSigningKeyPair();
      expect(validateEd25519PublicKey(kp.publicKey)).toBe(kp.keyId);
    });

    it('throws on a malformed key', () => {
      expect(() => validateEd25519PublicKey('!!!not base64 der!!!')).toThrow(/Invalid Ed25519 public key/);
    });

    it('throws on a non-Ed25519 key type', () => {
      const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const ecSpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
      expect(() => validateEd25519PublicKey(ecSpki)).toThrow(/Expected ed25519/);
    });
  });

  describe('trust ladder', () => {
    it('orders community < trusted < official < builtin', () => {
      expect(meetsTrust('builtin', 'community')).toBe(true);
      expect(meetsTrust('official', 'trusted')).toBe(true);
      expect(meetsTrust('trusted', 'trusted')).toBe(true);
      expect(meetsTrust('community', 'trusted')).toBe(false);
      expect(meetsTrust('trusted', 'official')).toBe(false);
    });

    it('recognizes valid trust values', () => {
      expect(isSkillKeyTrust('builtin')).toBe(true);
      expect(isSkillKeyTrust('community')).toBe(true);
      expect(isSkillKeyTrust('nope')).toBe(false);
      expect(isSkillKeyTrust(42)).toBe(false);
    });
  });
});
