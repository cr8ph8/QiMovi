/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
  Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Qi | Can I Screenwrite?'
const SITE_URL = 'https://caniscreenwrite.com'
const SIGN_UP_URL = `${SITE_URL}/auth?invited=1`

interface PlatformInvitationProps {
  displayName?: string
}

const PlatformInvitationEmail = ({ displayName }: PlatformInvitationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandMark}>Qi</Text>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          {displayName ? `Hi ${displayName}, you've` : "You've"} been personally
          invited to join{' '}
          <Link href={SITE_URL} style={link}>
            <strong>{SITE_NAME}</strong>
          </Link>
          &nbsp;— the AI-powered screenplay competition and feedback platform.
        </Text>
        <Text style={text}>
          Submit your screenplays, receive detailed AI-driven analysis across
          structure, dialogue, character depth, and more — then see how your work
          ranks on the leaderboard.
        </Text>
        <Button style={button} href={SIGN_UP_URL}>
          Create Your Account
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this
          email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PlatformInvitationEmail,
  subject: "You've been invited to Qi | Can I Screenwrite?",
  displayName: 'Platform invitation',
  previewData: { displayName: 'Writer' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const brandMark = { fontSize: '28px', fontWeight: 'bold' as const, color: '#c5952a', margin: '0 0 24px', fontFamily: "'Georgia', serif" }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const link = { color: '#c5952a', textDecoration: 'underline' }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const button = {
  backgroundColor: '#c5952a',
  color: '#0a0c10',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: 'bold' as const,
  fontFamily: "'Georgia', serif",
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.5' }
