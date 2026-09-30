import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Qi | Can I Screenwrite?"

interface WelcomeProps {
  displayName?: string
}

const WelcomeEmail = ({ displayName }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME} — your screenwriting journey starts now</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {displayName ? `Welcome, ${displayName}!` : 'Welcome aboard!'}
        </Heading>
        <Text style={text}>
          You're now part of the {SITE_NAME} community — a platform where screenwriters
          submit, compete, and get AI-powered feedback on their work.
        </Text>
        <Text style={text}>
          Here's what you can do next:
        </Text>
        <Text style={listItem}>📝 Submit your first screenplay</Text>
        <Text style={listItem}>🏆 Enter the AI Competition</Text>
        <Text style={listItem}>📊 Get scored by our AI judges</Text>
        <Hr style={hr} />
        <Button style={button} href="https://caniscreenwrite.com/submit">
          Submit Your First Script
        </Button>
        <Text style={footer}>
          Best regards,<br />The {SITE_NAME} Team
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: (data: Record<string, any>) =>
    data.displayName
      ? `Welcome to Qi, ${data.displayName}!`
      : 'Welcome to Qi | Can I Screenwrite?',
  displayName: 'Welcome email',
  previewData: { displayName: 'Alex' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const listItem = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 8px', paddingLeft: '8px' }
const hr = { borderColor: '#e5e5e5', margin: '24px 0' }
const button = {
  backgroundColor: '#c5952a',
  color: '#0a0c10',
  padding: '12px 24px',
  borderRadius: '8px',
  fontWeight: 'bold' as const,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-block' as const,
  fontFamily: "'Georgia', serif",
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', lineHeight: '1.5' }
