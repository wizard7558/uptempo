import Link from "next/link";

import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function MarketingComponentsPage() {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)] px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-4">
            <span className="eyebrow-rule" />
            <span className="eyebrow">Design system</span>
          </div>
          <h1 className="display text-5xl text-[var(--ink)]">
            Editorial components
          </h1>
          <p className="max-w-2xl text-sm text-[var(--ink-soft)]">
            Reference implementation for customer-facing surfaces.
          </p>
        </div>

        <Card variant="default" className="editorial-card-hover">
          <CardHeader>
            <CardTitle className="font-display text-2xl font-light">Buttons</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button variant="default" >
              Primary action
            </Button>
            <Button variant="outline" >
              Secondary action
            </Button>
            <Button variant="ghost" >
              Ghost action
            </Button>
          </CardContent>
        </Card>

        <Card variant="default">
          <CardHeader>
            <CardTitle className="font-display text-2xl font-light">Form field</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field htmlFor="demo-name" label="Client name">
              <Field.Input id="demo-name" placeholder="Emma Chamberlain" />
            </Field>
            <div className="flex gap-2">
              <Badge variant="default">Confirmed</Badge>
              <Badge variant="default">Arrived</Badge>
            </div>
          </CardContent>
        </Card>

        <Link href="/" className="editorial-link text-xs">
          Back to home
        </Link>
      </div>
    </div>
  );
}
