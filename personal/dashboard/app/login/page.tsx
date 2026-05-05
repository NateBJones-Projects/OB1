type Props = {
  searchParams: Promise<{ error?: string; from?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { error, from } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <form
        method="post"
        action="/api/auth/login"
        className="w-full max-w-sm space-y-4 p-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-lg font-medium">Open Brain</h1>
        <input type="hidden" name="from" value={from ?? "/"} />
        <label className="block">
          <span className="text-sm text-zinc-500">Password</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 focus:outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
        </label>
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">Incorrect password.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
