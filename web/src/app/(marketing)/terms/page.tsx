import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms and Conditions — Uptempo Bookings",
};

export default function TermsPage() {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)]">
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="inline-flex items-center gap-4">
          <span className="eyebrow-rule" />
          <span className="eyebrow">Legal</span>
        </div>
        <h1 className="display mt-6 text-4xl leading-tight text-[var(--ink)] md:text-5xl">
          Terms and Conditions
        </h1>
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          Last updated: April 2, 2026
        </p>
        <div
          className="mt-10 max-w-none space-y-6 border-t border-[var(--line)] pt-8 text-[var(--ink-soft)] leading-relaxed
          [&_h2]:mt-12 [&_h2]:scroll-mt-20 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-light [&_h2]:tracking-tight [&_h2]:text-[var(--ink)] [&_h2:first-of-type]:mt-10
          [&_p]:leading-relaxed
          [&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5
          [&_li]:leading-relaxed
          [&_strong]:font-medium [&_strong]:text-[var(--ink)]
          [&_a]:text-[var(--ink)] [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-[var(--ink-soft)]"
        >

      <h2>1. Overview</h2>
      <p>
        These Terms and Conditions govern your use of the Uptempo Bookings platform
        (&quot;Service&quot;), operated by Uptempo Bookings (&quot;we,&quot;
        &quot;us,&quot; or &quot;our&quot;) at bookuptempo.com. By using the
        Service, you agree to these terms.
      </p>

      <h2>2. Service Description</h2>
      <p>
        Uptempo is an all-in-one booking and management platform that
        enables business owners to manage appointments, scheduling, clients,
        payments, memberships, and revenue, and enables clients to book and
        manage appointments online.
      </p>

      <h2>3. Accounts</h2>
      <p>
        Business owners create accounts to manage their business. Clients provide
        contact information when booking appointments. You are responsible for
        maintaining the confidentiality of your account credentials.
      </p>

      <h2>4. SMS Messaging Program</h2>
      <p>
        <strong>Program name:</strong> Uptempo Appointment Notifications
      </p>
      <p>
        <strong>Description:</strong> When you provide your phone number and
        consent during the booking process, you will receive automated
        appointment-related text messages including reminders, confirmations,
        rescheduling updates, and cancellation notices from the business
        you book with.
      </p>
      <ul>
        <li>
          <strong>Message frequency:</strong> Message frequency varies based on
          your appointment schedule. Typically 1-3 messages per appointment
          (confirmation, reminder, and any changes).
        </li>
        <li>
          <strong>Message and data rates may apply.</strong> Contact your
          carrier for details about your text messaging plan.
        </li>
        <li>
          For help, reply <strong>HELP</strong> to any message, or contact us at{" "}
          <a href="mailto:riley@bellaso.ai">riley@bellaso.ai</a>.
        </li>
        <li>
          To stop receiving messages, reply <strong>STOP</strong> to any
          message. You will receive a one-time confirmation and no further
          messages will be sent. You can re-subscribe at any time by texting{" "}
          <strong>START</strong>.
        </li>
        <li>
          SMS messages are limited to appointment-related notifications. We do
          not send marketing or promotional messages.
        </li>
        <li>
          Carriers supported: All major US carriers including AT&T, T-Mobile,
          Verizon, and others. Carrier support is not guaranteed.
        </li>
        <li>
          Carriers are not liable for delayed or undelivered messages.
        </li>
        <li>
          For details on how we collect, use, and protect your information,
          including your SMS opt-in data, see our{" "}
          <a href="/privacy">Privacy Policy</a>. We do not sell or share your
          mobile information or SMS opt-in data with third parties or affiliates
          for marketing or promotional purposes.
        </li>
      </ul>

      <h2>5. Google Calendar Integration</h2>
      <p>
        Business owners may connect their Google Calendar to Uptempo to enable
        availability sync and automatic event creation for bookings. By
        connecting your Google Calendar, you authorize Uptempo to:
      </p>
      <ul>
        <li>Read free/busy information from your selected calendar</li>
        <li>Create, update, and delete calendar events for appointments</li>
        <li>Access your Google account email for identification</li>
      </ul>
      <p>
        You may disconnect Google Calendar at any time from Settings. Uptempo&apos;s use of Google Calendar data complies with the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>6. Payments</h2>
      <p>
        Payments are processed securely through Stripe. Business owners set their
        own service prices. Uptempo collects a platform fee on each
        transaction. Refund and cancellation policies are set by each individual
        business.
      </p>

      <h2>7. Cancellation and No-Show Policies</h2>
      <p>
        Each business sets its own cancellation window and fee policies. These are
        displayed during the booking process. If a card is on file, fees may be
        charged automatically according to the business&apos;s stated policy.
      </p>

      <h2>8. User Responsibilities</h2>
      <ul>
        <li>Provide accurate contact information</li>
        <li>Show up for booked appointments or cancel within the required window</li>
        <li>Do not misuse the platform or attempt unauthorized access</li>
      </ul>

      <h2>9. Business Owner Responsibilities</h2>
      <ul>
        <li>Provide accurate service descriptions and pricing</li>
        <li>Honor confirmed appointments</li>
        <li>Comply with applicable laws regarding data collection and payments</li>
      </ul>

      <h2>10. Limitation of Liability</h2>
      <p>
        Uptempo provides the platform as-is. We are not liable for disputes
        between businesses and clients, service quality, or losses arising from
        platform use beyond the fees paid to us.
      </p>

      <h2>11. Privacy</h2>
      <p>
        Your use of the Service is also governed by our{" "}
        <a href="/privacy">Privacy Policy</a>, which describes how we collect,
        use, and protect your data.
      </p>

      <h2>12. Changes to Terms</h2>
      <p>
        We may update these terms from time to time. Continued use of the
        Service after changes constitutes acceptance of the updated terms.
      </p>

      <h2>13. Contact</h2>
      <p>
        For questions about these Terms, contact us at{" "}
        <a href="mailto:riley@bellaso.ai">riley@bellaso.ai</a>.
      </p>
        </div>
      </article>
    </div>
  );
}
