import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SelfHostedPaymentsCard({
  configured,
  webhookUrl,
}: {
  configured: boolean;
  webhookUrl: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          {configured
            ? "Stripe is configured. Charges go to your Stripe account, with no platform fee."
            : "Payments are off until STRIPE_SECRET_KEY is set."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Point a Stripe webhook at this URL:</p>
        <code className="block break-all rounded bg-muted px-2 py-1">{webhookUrl}</code>
      </CardContent>
    </Card>
  );
}
