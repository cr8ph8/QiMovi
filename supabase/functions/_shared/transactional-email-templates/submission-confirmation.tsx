import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Qi | Can I Screenwrite?"

interface SubmissionConfirmationProps {
  title?: string
  displayName?: string
}

const SubmissionConfirmationEmail = ({ title, displayName }: SubmissionConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your screenplay {title ? `"${title}" ` : ''}has been submitted</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          Submission Received ✓
        </Heading>
        <Text style={text}>
          {displayName ? `Hey ${displayName}, ` : ''}Your screenplay
          {title ? ` "${title}"` : ''} has been successfully submitted to {SITE_NAME}.
        </Text>
        <Text style={text}>
          Our AI judges will evaluate your work across originality, structure,
          character depth, dialogue, emotion, and more. You'll receive a detailed
          score breakdown once judging is complete.
        </Text>
        <Hr style={hr} />
        <Button style={button} href="https://caniscreenwrite.com/my-submissions">
          View Your Submissions
        </Button>
        <Text style={footer}>
          Best regards,<br />The {SITE_NAME} Team
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SubmissionConfirmationEmail,
  subject: (data: Record<string, any>) =>
    data.title
      ? `Submission received: "${data.title}"`
      : 'Your screenplay has been submitted',
  displayName: 'Submission confirmation',
  previewData: { title: 'The Last Algorithm', displayName: 'Alex' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
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
