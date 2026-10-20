import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Uptempo Bookings",
};

export default function PrivacyPage() {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)]">
      <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="inline-flex items-center gap-4">
          <span className="eyebrow-rule" />
          <span className="eyebrow">Legal</span>
        </div>
        <h1 className="display mt-6 text-4xl leading-tight text-[var(--ink)] md:text-5xl">
          Privacy Policy
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

      <h2>1. Introduction</h2>
      <p>
        Uptempo Bookings (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the
        bookuptempo.com platform, an all-in-one booking and management
        service. This Privacy Policy describes how we collect, use, and protect
        your personal information.
      </p>

      <h2>2. Information We Collect</h2>
      <p>We collect the following types of information:</p>
      <ul>
        <li>
          <strong>Account information:</strong> Name, email address, and
          password when you create an account.
        </li>
        <li>
          <strong>Booking information:</strong> Name, email, phone number, and
          appointment details when you book an appointment.
        </li>
        <li>
          <strong>Phone number:</strong> When you provide your phone number
          during booking, we use it solely to send appointment reminders,
          confirmations, and cancellation notifications via SMS.
        </li>
        <li>
          <strong>Payment information:</strong> Payment details are processed
          securely by Stripe. We do not store your credit card number.
        </li>
        <li>
          <strong>Usage data:</strong> We collect anonymized usage data to
          improve our service.
        </li>
      </ul>

      <h2>3. How We Use Your Information</h2>
      <p>We use your information to:</p>
      <ul>
        <li>Process and manage your appointments</li>
        <li>
          Send appointment reminders, confirmations, and cancellation notices
          via email and SMS
        </li>
        <li>Process payments through Stripe</li>
        <li>Provide customer support</li>
        <li>Improve our platform and services</li>
      </ul>

      <h2>4. SMS Communications</h2>
      <p>
        When you provide your phone number and consent to SMS notifications
        during the booking process, we will send you appointment-related text
        messages including reminders, confirmations, and cancellation notices.
      </p>
      <ul>
        <li>Message frequency varies based on your appointment schedule.</li>
        <li>Message and data rates may apply.</li>
        <li>
          You can opt out at any time by replying <strong>STOP</strong> to any
          message.
        </li>
        <li>
          Reply <strong>HELP</strong> for support information.
        </li>
        <li>
          We will never send marketing or promotional messages via SMS.
        </li>
      </ul>
      <p>
        <strong>
          No mobile information will be sold or shared with third parties or
          affiliates for marketing or promotional purposes. Information sharing
          with subcontractors in support services, such as customer service, is
          permitted. All other use case categories exclude text messaging
          originator opt-in data and consent; this information will not be
          shared with any third parties.
        </strong>
      </p>

      <h2>5. Google Calendar Integration</h2>
      <p>
        When business owners connect their Google Calendar to Uptempo, we request
        access to read and write calendar events. Specifically:
      </p>
      <ul>
        <li>
          <strong>What we access:</strong> Calendar event times (free/busy
          status), the ability to create events for confirmed bookings, and your
          Google account email address for identification.
        </li>
        <li>
          <strong>How we use it:</strong> We read your calendar&apos;s free/busy
          data solely to prevent double-booking. When a client books an
          appointment, we create a calendar event on your selected calendar. We
          do not read, store, or share the content of your existing calendar
          events.
        </li>
        <li>
          <strong>Storage:</strong> We store encrypted OAuth tokens to maintain
          the connection. We do not store your calendar event data beyond
          free/busy time ranges needed for availability checks.
        </li>
        <li>
          <strong>Revocation:</strong> You can disconnect Google Calendar at any
          time from Settings → Calendar Connections. This immediately removes
          our access. You can also revoke access from your{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account permissions
          </a>{" "}
          page.
        </li>
        <li>
          <strong>Limited use:</strong> Uptempo&apos;s use of Google Calendar
          data adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We do not use Google Calendar
          data for advertising, and we do not transfer it to third parties
          except as necessary to provide the scheduling service.
        </li>
      </ul>

      <h2>6. Data Sharing</h2>
      <p>
        We do not sell, rent, or share your personal information with third
        parties for their marketing purposes. We share data only with:
      </p>
      <ul>
        <li>
          <strong>Business owners:</strong> Your booking and contact information
          is shared with the business you book with so they can provide their
          services.
        </li>
        <li>
          <strong>Service providers:</strong> We use Stripe for payments, Twilio
          for SMS, Resend for email, and Google Calendar API for scheduling
          integration. These providers process data on our behalf under strict
          data processing agreements.
        </li>
      </ul>

      <h2>7. Data Security</h2>
      <p>
        We implement industry-standard security measures including encryption in
        transit (TLS) and at rest, secure database access controls, and regular
        security reviews to protect your personal information.
      </p>

      <h2>8. Data Retention</h2>
      <p>
        We retain your personal data for as long as your account is active or
        as needed to provide services. You can request deletion of your data at
        any time by contacting us.
      </p>

      <h2>9. Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you</li>
        <li>Request correction of inaccurate data</li>
        <li>Request deletion of your data</li>
        <li>Opt out of SMS communications at any time</li>
      </ul>

      <h2>10. Contact Us</h2>
      <p>
        If you have questions about this Privacy Policy or your personal data,
        contact us at{" "}
        <a href="mailto:privacy@bookuptempo.com">privacy@bookuptempo.com</a>.
      </p>
        </div>
      </article>
    </div>
  );
}
