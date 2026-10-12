export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">
          You do not have permission to access the admin area.
        </p>
        <a href="/login" className="text-primary underline">
          Return to login
        </a>
      </div>
    </div>
  );
}
