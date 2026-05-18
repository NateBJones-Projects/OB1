import "server-only";

import {
  createClient,
  type EmailOtpType,
  type Provider,
  type User,
} from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var is required`);
  }
  return value;
}

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://127.0.0.1:3001"
  ).replace(/\/$/, "");
}

function createSupabaseAuthClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export function getMagicLinkRedirectUrl(next = "/") {
  return `${getBaseUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

async function getOAuthSignInUrl(provider: Provider, next = "/") {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getMagicLinkRedirectUrl(next),
    },
  });

  if (error) {
    throw error;
  }

  if (!data.url) {
    throw new Error(`No ${provider} sign-in URL returned from Supabase Auth`);
  }

  return data.url;
}

export async function getGithubSignInUrl(next = "/") {
  return getOAuthSignInUrl("github", next);
}

export async function getGoogleSignInUrl(next = "/") {
  return getOAuthSignInUrl("google", next);
}

export async function signInWithPassword(email: string, password: string) {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("No user returned from Supabase Auth");
  }

  return data.user;
}

export async function signUpWithPassword(email: string, password: string) {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getMagicLinkRedirectUrl("/"),
    },
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function verifyMagicLink(
  tokenHash: string,
  type: EmailOtpType
): Promise<User> {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("No user returned from Supabase Auth");
  }

  return data.user;
}

export async function exchangeAuthCodeForUser(code: string): Promise<User> {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("No user returned from Supabase Auth");
  }

  return data.user;
}
