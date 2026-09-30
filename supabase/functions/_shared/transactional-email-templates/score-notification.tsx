import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Qi | Can I Screenwrite?"

interface ScoreNotificationProps {
  title?: string
  totalScore?: number
  displayName?: string
  isCompetitionEntry?: boolean
}

const ScoreNotificationEmail = ({ title, totalScore, displayName, isCompetitionEntry }: ScoreNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {isCompetitionEntry
        ? `Submission received & scored${title ? ` — "${title}"` : ''}!`
        : `Your scores are in${title ? ` for "${title}"` : ''}!`}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {isCompetitionEntry ? 'Submission Received & Scored 🎬' : 'Your Scores Are Ready 🎬'}
        </Heading>
        {isCompetitionEntry && (
          <Text style={text}>
            {displayName ? `Hey ${displayName}, ` : ''}Your screenplay
            {title ? ` "${title}"` : ''} has been successfully submitted to {SITE_NAME} and
            has already been evaluated by our AI judges.
          </Text>
        )}
        {!isCompetitionEntry && (
          <Text style={text}>
            {displayName ? `Hey ${displayName}, ` : ''}Great news — AI judging is complete
            {title ? ` for "${title}"` : ''}.
          </Text>
        )}
        {totalScore != null && (
          <Text style={scoreBox}>
            Total Score: {totalScore}/100
          </Text>
        )}
        <Text style={text}>
          Your detailed breakdown covers originality, structure, character depth,
          dialogue, emotion, theme, and format adherence. Check the full report
          to see where your screenplay shines and where it can improve.
        </Text>
        <Hr style={hr} />
        <Button style={button} href="https://caniscreenwrite.com/my-submissions">
          View Your {isCompetitionEntry ? 'Submission' : 'Scores'}
        </Button>
        <Text style={footer}>
          Best regards,<br />The {SITE_NAME} Team
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ScoreNotificationEmail,
  subject: (data: Record<string, any>) =>
    data.title
      ? `Scores ready for "${data.title}"`
      : 'Your screenplay scores are ready!',
  displayName: 'Score notification',
  previewData: { title: 'The Last Algorithm', totalScore: 78, displayName: 'Alex', isCompetitionEntry: true },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const scoreBox = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#c5952a',
  textAlign: 'center' as const,
  padding: '16px',
  margin: '0 0 16px',
  backgroundColor: '#faf7f0',
  borderRadius: '8px',
  border: '1px solid #e8dcc8',
  fontFamily: "'Georgia', serif",
}
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
