import fs from 'fs/promises';
import path from 'path';
import {
  randomUUID,
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'crypto';
import argon2 from 'argon2';

export type LicenseStatus = 'active' | 'revoked' | 'expired' | 'none';

export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: string;

  // Licensing
  licenseKey?: string | null;
  licenseStatus?: LicenseStatus; // if undefined, treat as 'none' for stricter checks
}

const USERS_ENC_PATH = path.join(process.cwd(), 'users.enc');
const MASTER_PASSWORD = process.env.ONESTAR_USERS_KEY ?? 'onestar-dev-users';
const KEY = createHash('sha256').update(MASTER_PASSWORD).digest(); // 32 bytes
const IV_LENGTH = 12; // for AES-256-GCM

async function loadUsersEncrypted(): Promise<User[]> {
  try {
    const data = await fs.readFile(USERS_ENC_PATH);
    const iv = data.slice(0, IV_LENGTH);
    const tag = data.slice(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = data.slice(IV_LENGTH + 16);

    const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as User[];
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      // No file yet -> no users yet
      return [];
    }

    // Key mismatch, corrupted file, etc.
    console.error(
      '[userStore] Failed to decrypt users.enc – treating as empty user store. Error:',
      err
    );
    return [];
  }
}

async function saveUsersEncrypted(users: User[]): Promise<void> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(users)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const data = Buffer.concat([iv, tag, encrypted]);
  await fs.writeFile(USERS_ENC_PATH, data);
}

export async function getAllUsers(): Promise<User[]> {
  return loadUsersEncrypted();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getAllUsers();
  return (
    users.find(
      (user) => user.email.toLowerCase() === email.toLowerCase()
    ) || null
  );
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await getAllUsers();
  return users.find((user) => user.username === username) || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await getAllUsers();
  return users.find((user) => user.id === id) || null;
}

export async function createUser(
  email: string,
  username: string,
  passwordPlain: string
): Promise<User> {
  const passwordHash = await argon2.hash(passwordPlain);

  const newUser: User = {
    id: randomUUID(),
    email,
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
    licenseKey: null,
    licenseStatus: 'none',
  };

  const users = await getAllUsers();
  users.push(newUser);
  await saveUsersEncrypted(users);

  return newUser;
}

export async function verifyUser(
  email: string,
  passwordPlain: string
): Promise<User | null> {
  const user = await getUserByEmail(email);
  if (user && (await argon2.verify(user.passwordHash, passwordPlain))) {
    return user;
  }
  return null;
}

/**
 * Unified lookup used by share API:
 * accepts either @username, username, or email.
 */
export async function findUserByEmailOrUsername(
  identifier: string
): Promise<User | null> {
  const normalized = identifier.trim().replace(/^@/, '');
  const users = await getAllUsers();

  const lower = normalized.toLowerCase();

  // Try email match (case-insensitive)
  const byEmail = users.find(
    (u) => u.email.toLowerCase() === lower
  );
  if (byEmail) return byEmail;

  // Then try username (case-sensitive, as stored)
  const byUsername = users.find((u) => u.username === normalized);
  if (byUsername) return byUsername;

  return null;
}

/**
 * Internal helpers for licensing and user lookup
 */

function generateLicenseKey(): string {
  // 16 random bytes -> 32 hex chars, grouped like XXXX-XXXX-...
  const raw = randomBytes(16).toString('hex').toUpperCase();
  const groups = raw.match(/.{1,4}/g) ?? [raw];
  return groups.join('-');
}

function isUserLicensed(user: User): boolean {
  // Strict: require both licenseKey and status === 'active'
  if (!user.licenseKey) return false;
  if (!user.licenseStatus) return false;
  return user.licenseStatus === 'active';
}

async function findUserRecordAndIndex(
  identifier: string
): Promise<{ users: User[]; index: number; user: User }> {
  const users = await getAllUsers();
  const normalized = identifier.trim().replace(/^@/, '');
  const lower = normalized.toLowerCase();

  const index = users.findIndex(
    (u) =>
      u.email.toLowerCase() === lower ||
      u.username === normalized
  );

  if (index === -1) {
    throw new Error(`User not found for identifier: ${identifier}`);
  }

  return { users, index, user: users[index] };
}

/**
 * Reset a user's password, but ONLY if they have an active license.
 *
 * `identifier` can be email, username, or @username.
 */
export async function resetUserPassword(
  identifier: string,
  newPasswordPlain: string
): Promise<User> {
  const { users, index, user } = await findUserRecordAndIndex(identifier);

  if (!isUserLicensed(user)) {
    throw new Error(
      `User ${identifier} does not have an active license; password reset denied.`
    );
  }

  const newPasswordHash = await argon2.hash(newPasswordPlain);

  const updatedUser: User = {
    ...user,
    passwordHash: newPasswordHash,
  };

  users[index] = updatedUser;
  await saveUsersEncrypted(users);

  return updatedUser;
}

/**
 * Issue (or re-issue) a license to a user.
 * Returns the updated user and the license key you can give them.
 */
export async function issueLicenseToUser(
  identifier: string
): Promise<{ user: User; licenseKey: string }> {
  const { users, index, user } = await findUserRecordAndIndex(identifier);

  const licenseKey = generateLicenseKey();

  const updatedUser: User = {
    ...user,
    licenseKey,
    licenseStatus: 'active',
  };

  users[index] = updatedUser;
  await saveUsersEncrypted(users);

  return { user: updatedUser, licenseKey };
}

/**
 * Revoke a user's license (but keep their account).
 */
export async function revokeLicenseForUser(
  identifier: string
): Promise<User> {
  const { users, index, user } = await findUserRecordAndIndex(identifier);

  const updatedUser: User = {
    ...user,
    licenseStatus: 'revoked',
  };

  users[index] = updatedUser;
  await saveUsersEncrypted(users);

  return updatedUser;
}
