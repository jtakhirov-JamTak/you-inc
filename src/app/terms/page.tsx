import Link from "next/link";
import type { Metadata } from "next";
import { StormBackground } from "@/components/brand/StormBackground";

export const metadata: Metadata = {
  title: "Terms of Service — You, Inc.",
};

// DRAFT legal scaffold — template language, wired up and linked. Founder must
// replace with lawyer-reviewed copy before launch.
const UPDATED = "2026-06-18";

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

export default function TermsPage() {
  return (
    <div className="relative min-h-dvh px-5 pb-24 pt-[max(2rem,env(safe-area-inset-top))]">
      <StormBackground />
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
          Terms of Service
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

        <Section title="Acceptance">
          <p>
            By creating an account or using You, Inc. (&ldquo;the service&rdquo;)
            you agree to these Terms and to our{" "}
            <Link href="/privacy" className="text-accent-ink underline">
              Privacy Policy
            </Link>
            . If you don&rsquo;t agree, don&rsquo;t use the service.
          </p>
        </Section>

        <Section title="Not professional advice">
          <p>
            You, Inc. is a self-development tool. It is{" "}
            <span className="font-semibold text-ink">not</span> financial,
            medical, legal, or mental-health advice, and does not replace care
            from a qualified professional. If you are in crisis or may harm
            yourself or others, contact emergency services or a crisis line
            immediately.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            You are responsible for your account and for keeping your login
            secure. You must provide accurate information and be old enough to
            consent in your jurisdiction. [Set a minimum age.]
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            Don&rsquo;t misuse the service, attempt to break or overload it, or
            use it to harm others. We may suspend accounts that do.
          </p>
        </Section>

        <Section title="Disclaimers & liability">
          <p>
            The service is provided &ldquo;as is&rdquo; without warranties. To
            the extent permitted by law, we are not liable for indirect or
            consequential damages arising from your use of the service. [Have
            counsel set the appropriate limitation and governing law.]
          </p>
        </Section>

        <Section title="Changes & contact">
          <p>
            We may update these Terms; material changes will be noted here.
            Questions: [your support email].
          </p>
        </Section>

        <p className="mt-8 text-[13px] font-medium text-ink-soft">
          See also our{" "}
          <Link href="/privacy" className="text-accent-ink underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
