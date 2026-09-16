export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Login page renders without the sidebar (Sidebar checks pathname)
  return <>{children}</>;
}
