import { LoginForm } from "./LoginForm";

type LoginPageProps = {
  searchParams: Promise<{
    redirect?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect } = await searchParams;
  const redirectTo = redirect || "/";

  return (
    <main className="shell">
      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
