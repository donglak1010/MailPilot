export function ConfigError() {
  return (
    <main role="alert" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-3 p-6">
      <h1 className="text-xl font-semibold">MailPilot is not configured</h1>
      <p className="text-sm text-muted-foreground">
        Copy <code className="rounded bg-muted px-1">.env.example</code> to{' '}
        <code className="rounded bg-muted px-1">.env.local</code> and set{' '}
        <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-muted px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart the dev server.
      </p>
    </main>
  )
}
