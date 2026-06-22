import Link from "next/link";
import type { Metadata } from "next";
import { PageBackground } from "@/components/brand/PageBackground";

export const metadata: Metadata = {
  title: "Privacy Policy — You, Inc.",
};

// DRAFT legal scaffold — template language + the real sub-processor list, wired
// up and linked. Founder must replace the body text with lawyer-reviewed copy
// before public/paid launch. The sub-processor table reflects the actual data
// flows in the codebase. Add/remove rows as services are wired up (e.g. a
// payment processor when monetization lands).
const UPDATED = "2026-06-18";

const SUBPROCESSORS: { name: string; purpose: string; data: string }[] = [
  { name: "Supabase", purpose: "Database, authentication, hosting", data: "Account, profile, and the entries you create" },
  { name: "Anthropic (Claude)", purpose: "AI features", data: "Aggregated habit and sprint statistics, your habit and vice names, and weekly value movements, to phrase your performance analysis" },
  { name: "Sentry", purpose: "Error monitoring", data: "Technical error data (personal content scrubbed)" },
  { name: "Vercel", purpose: "Application hosting", data: "Standard request/network metadata" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] font-medium leading-[1.6] text-ink-soft">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="relative min-h-dvh px-5 pb-24 pt-[max(2rem,env(safe-area-inset-top))]">
      <PageBackground />
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink underline active:opacity-70"
        >
          ← Back
        </Link>

        <h1
          className="mt-4 font-display text-[30px] font-medium leading-[1.12] text-ink"
          style={{ letterSpacing: "-0.7px" }}
        >
          Privacy Policy
        </h1>
        <p className="mt-2 text-[13px] font-medium text-ink-muted">
          Last updated {UPDATED}
        </p>

        <div className="mt-5 rounded-card border border-warm/40 bg-warm-soft p-4">
          <p className="text-[13px] font-semibold leading-[1.5] text-ink">
            ⚠ DRAFT — template text. This must be reviewed by a lawyer and the
            placeholders completed before launch. It is not yet legal advice.
          </p>
        </div>

        <Section title="Who we are">
          <p>
            You, Inc. (&ldquo;we&rdquo;) is a self-development app. This policy
            explains what personal data we collect, how we use it, and the
            choices you have. Contact: [your support email].
          </p>
        </Section>

        <Section title="What we collect">
          <p>
            Account information (email, first name) and the content you create
            in the app — your goals, plans, habits, reflections, and related
            inputs. This content can be personal.
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            To provide the features you request, generate AI feedback, keep the
            service running, and diagnose errors. We do not sell your personal
            data.
          </p>
        </Section>

        <Section title="Service providers (sub-processors)">
          <p>We share data with these providers only as needed to run the app:</p>
          <ul className="mt-2 space-y-2">
            {SUBPROCESSORS.map((s) => (
              <li
                key={s.name}
                className="rounded-card-xs border border-hairline bg-surface p-3"
              >
                <p className="text-[13px] font-semibold text-ink">{s.name}</p>
                <p className="text-[12px] leading-[1.5] text-ink-soft">
                  {s.purpose} — {s.data}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-muted">
            [Confirm each provider&rsquo;s data-processing terms and that AI
            providers&rsquo; training opt-out is enabled before publishing.]
          </p>
        </Section>

        <Section title="Retention">
          <p>
            We keep your data while your account is active. When you delete an
            individual conversation or entry, it is removed from your account
            immediately and permanently deleted from our systems within 30 days.
            When you delete your account, all of your data is erased. [Confirm
            these windows and add any backup-retention window with your
            reviewer.]
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can access and update your profile in the app, download all of
            your data as a JSON file (portability), and permanently delete your
            account and all associated data from{" "}
            <Link href="/settings" className="text-accent-ink underline">
              Settings
            </Link>
            . [Add region-specific rights and how to exercise them.]
          </p>
        </Section>

        <Section title="Security">
          <p>
            Data is encrypted in transit and at rest by our infrastructure
            providers. No system is perfectly secure, but we take reasonable
            measures to protect your information.
          </p>
        </Section>

        <Section title="Changes & contact">
          <p>
            We may update this policy; material changes will be noted here.
            Questions: [your support email].
          </p>
        </Section>

        <p className="mt-8 text-[13px] font-medium text-ink-soft">
          See also our{" "}
          <Link href="/terms" className="text-accent-ink underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
