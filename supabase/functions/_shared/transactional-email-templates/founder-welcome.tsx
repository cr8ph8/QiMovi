import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Qi | Can I Screenwrite?"

interface FounderWelcomeProps {
  name?: string
}

const FounderWelcomeEmail = ({ name }: FounderWelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been selected as a Founder — {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        {/* Gold accent bar */}
        <Section style={accentBar} />

        <Heading style={h1}>
          {name ? `Congratulations, ${name}!` : 'Congratulations!'}
        </Heading>

        <Text style={tagline}>
          You've been selected as a <strong style={{ color: '#c5952a' }}>Founder</strong> of {SITE_NAME}.
        </Text>

        <Text style={text}>
          As one of the very first people on the platform, you're part of an exclusive group
          shaping the future of AI-judged screenwriting competitions. Your Founder status is permanent
          and comes with special privileges:
        </Text>

        <Section style={privilegeBox}>
          <Text style={privilegeItem}>🏅 Exclusive "Founder" badge on your profile</Text>
          <Text style={privilegeItem}>🔓 Extended platform access</Text>
          <Text style={privilegeItem}>📝 Free account with founder-level features</Text>
          <Text style={privilegeItem}>🎬 Early access to new competitions and tools</Text>
        </Section>

        <Text style={text}>
          Sign up using the link below to activate your Founder account. Your badge and access
          privileges will be granted automatically.
        </Text>

        <Button style={button} href="https://caniscreenwrite.com/auth">
          Claim Your Founder Account
        </Button>

        <Hr style={hr} />

        <Text style={footer}>
          Welcome to the founding circle.<br />
          The {SITE_NAME} Team
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: FounderWelcomeEmail,
  subject: (data: Record<string, any>) =>
    data.name
      ? `You're a Founder, ${data.name} — Welcome to Qi`
      : `You've been selected as a Founder — Qi | Can I Screenwrite?`,
  displayName: 'Founder welcome',
  previewData: { name: 'David' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const accentBar = { height: '4px', background: 'linear-gradient(135deg, #c5952a 0%, #a67a1e 100%)', borderRadius: '2px', marginBottom: '32px' }
const h1 = { fontSize: '26px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 12px', fontFamily: "'Georgia', serif" }
const tagline = { fontSize: '17px', color: '#333', lineHeight: '1.5', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const privilegeBox = { backgroundColor: '#faf6ee', border: '1px solid #e8dcc8', borderRadius: '8px', padding: '16px 20px', margin: '0 0 24px' }
const privilegeItem = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0 0 6px', paddingLeft: '4px' }
const hr = { borderColor: '#e5e5e5', margin: '28px 0' }
const button = {
  backgroundColor: '#c5952a',
  color: '#0a0c10',
  padding: '14px 28px',
  borderRadius: '8px',
  fontWeight: 'bold' as const,
  fontSize: '15px',
  textDecoration: 'none',
  display: 'inline-block' as const,
  fontFamily: "'Georgia', serif",
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.5' }
