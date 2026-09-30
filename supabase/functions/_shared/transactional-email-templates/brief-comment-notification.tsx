import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Qi | Can I Screenwrite?'

interface BriefCommentNotificationProps {
  briefTitle?: string
  authorName?: string
  commentBody?: string
  isReply?: boolean
  shareUrl?: string
  ownerName?: string
}

const BriefCommentNotificationEmail = ({
  briefTitle,
  authorName,
  commentBody,
  isReply,
  shareUrl,
  ownerName,
}: BriefCommentNotificationProps) => {
  const titleLabel = briefTitle ? `"${briefTitle}"` : 'your shared brief'
  const action = isReply ? 'replied to a comment on' : 'left a comment on'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${authorName ?? 'Someone'} ${action} ${titleLabel}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New feedback on your brief</Heading>
          <Text style={text}>
            {ownerName ? `Hi ${ownerName}, ` : ''}
            <strong>{authorName ?? 'Someone'}</strong> {action} {titleLabel}.
          </Text>
          {commentBody && (
            <Section style={quoteBox}>
              <Text style={quoteText}>{commentBody}</Text>
            </Section>
          )}
          <Hr style={hr} />
          {shareUrl && (
            <Button style={button} href={shareUrl}>
              View the conversation
            </Button>
          )}
          <Text style={footer}>
            You're receiving this because you own this shared brief.<br />
            — The {SITE_NAME} Team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: BriefCommentNotificationEmail,
  subject: (data: Record<string, any>) =>
    data.isReply
      ? `New reply${data.briefTitle ? ` on "${data.briefTitle}"` : ''}`
      : `New comment${data.briefTitle ? ` on "${data.briefTitle}"` : ''}`,
  displayName: 'Brief comment notification',
  previewData: {
    briefTitle: 'Untitled Brain Dump',
    authorName: 'Jordan',
    commentBody: 'Loved the second act pivot — the antagonist motivation feels much sharper.',
    isReply: false,
    shareUrl: 'https://caniscreenwrite.com/brief/abc123',
    ownerName: 'Alex',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Georgia', 'Times New Roman', serif" }
const container = { padding: '40px 25px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a1a1a', margin: '0 0 20px', fontFamily: "'Georgia', serif" }
const text = { fontSize: '15px', color: '#55575d', lineHeight: '1.6', margin: '0 0 16px' }
const quoteBox = {
  padding: '14px 18px',
  margin: '0 0 16px',
  backgroundColor: '#faf7f0',
  borderLeft: '3px solid #c5952a',
  borderRadius: '6px',
}
const quoteText = { fontSize: '14px', color: '#3a3a3a', lineHeight: '1.6', margin: 0, fontStyle: 'italic' as const }
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
