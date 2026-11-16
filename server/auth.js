import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'yimaru-consulting-secure-jwt-secret-key-2026-prod';
const TOKEN_EXPIRY = '7d';

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Sign JWT token for admin
 */
export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || 'admin',
      name: user.name || 'Admin'
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Authenticate admin with email and password
 * Supports both local accounts and Supabase Auth
 */
export async function authenticateAdmin(email, password) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  // 1. If Supabase is configured, try Supabase Auth first
  const supabase = db.getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (!error && data?.user) {
        return {
          user: {
            id: data.user.id,
            email: data.user.email,
            role: data.user.role || 'admin',
            name: data.user.user_metadata?.name || data.user.email.split('@')[0]
          },
          token: data.session?.access_token || signToken(data.user)
        };
      }
    } catch (err) {
      console.warn('[Auth] Supabase auth attempt failed, checking local credentials:', err.message);
    }
  }

  // 2. Check local admin store
  const admin = await db.getAdminByEmail(email);
  if (!admin) {
    throw new Error('Invalid email or password');
  }

  const matches = await comparePassword(password, admin.password_hash);
  if (!matches) {
    throw new Error('Invalid email or password');
  }

  const user = {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name
  };

  const token = signToken(user);
  return { user, token };
}

/**
 * Express middleware to require authenticated admin
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.split(' ')[1];

  // Try Supabase auth verification if configured
  const supabase = db.getSupabaseClient();
  if (supabase) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        req.user = {
          id: user.id,
          email: user.email,
          role: user.role || 'admin',
          name: user.user_metadata?.name || user.email.split('@')[0]
        };
        return next();
      }
    } catch (e) {
      // Fall through to local token verification
    }
  }

  // Verify local JWT
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = decoded;
  next();
}

