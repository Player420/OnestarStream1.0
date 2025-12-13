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

export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: string;
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
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
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
  const byEmail = users.find((u) => u.email.toLowerCase() === lower);
  if (byEmail) return byEmail;

  // Then try username (case-sensitive, as stored)
  const byUsername = users.find((u) => u.username === normalized);
  if (byUsername) return byUsername;

  return null;
}

/**
 * Reset a user's password by email or @username.
 *
 * - identifier: email or @username/username
 * - newPassword: plain-text password to be hashed with argon2
 *
 * Returns the updated user or null if no matching user is found.
 */
export async function resetUserPassword(
  identifier: string,
  newPassword: string
): Promise<User | null> {
  // Load all users once – this is the source of truth for saving back to users.enc
  const users = await getAllUsers();

  // Find the target user via the unified lookup
  const target = await findUserByEmailOrUsername(identifier);
  if (!target) {
    return null;
  }

  // Locate the user index in the current in-memory array
  const index = users.findIndex((u) => u.id === target.id);
  if (index === -1) {
    // Defensive: if for some reason the user isn't in this snapshot, bail safely
    return null;
  }

  // Hash the new password with argon2
  const passwordHash = await argon2.hash(newPassword);

  // Update the user record in-place, preserving id/email/username/createdAt
  const updatedUser: User = {
    ...users[index],
    passwordHash,
  };

  users[index] = updatedUser;

  // Persist encrypted to users.enc
  await saveUsersEncrypted(users);

  return updatedUser;
}
