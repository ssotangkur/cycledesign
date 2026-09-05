import { describe, it, expect } from 'vitest';
import { formatSessionLabel } from './formatSessionLabel';

const SESSION_ID = 'session-39947711-9bd6-4036-9b21-515e9ad337d1';

describe('formatSessionLabel', () => {
  describe('fallback to session ID', () => {
    it('should return last 8 chars of session ID when firstMessage is null', () => {
      expect(formatSessionLabel(null, SESSION_ID)).toBe('9ad337d1');
    });

    it('should return last 8 chars of session ID when firstMessage is empty', () => {
      expect(formatSessionLabel('', SESSION_ID)).toBe('9ad337d1');
    });

    it('should return last 8 chars of session ID when firstMessage is whitespace only', () => {
      expect(formatSessionLabel('   ', SESSION_ID)).toBe('9ad337d1');
    });

    it('should return last 8 chars of session ID when firstMessage is only newlines/tabs', () => {
      expect(formatSessionLabel('\n\t\r\n', SESSION_ID)).toBe('9ad337d1');
    });
  });

  describe('message content labels', () => {
    it('should return short messages unchanged', () => {
      expect(formatSessionLabel('Hello world', SESSION_ID)).toBe('Hello world');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(formatSessionLabel('  Hello world  ', SESSION_ID)).toBe('Hello world');
    });

    it('should replace newlines, carriage returns and tabs with spaces', () => {
      const message = 'Hi there!\nNew line\there.';
      expect(formatSessionLabel(message, SESSION_ID)).toBe('Hi there! New line here.');
    });

    it('should collapse consecutive special characters into a single space', () => {
      expect(formatSessionLabel('a\n\nb', SESSION_ID)).toBe('a b');
      expect(formatSessionLabel('line one\r\nline two', SESSION_ID)).toBe('line one line two');
    });

    it('should replace special characters in the issue #49 E2E message', () => {
      const message = 'Hello, this is a test message!\nWith special\tcharacters.';
      // Cleaned message is 55 chars, so truncation also applies
      expect(formatSessionLabel(message, SESSION_ID)).toBe(
        'Hello, this is a test message! With special charac...',
      );
    });
  });

  describe('truncation', () => {
    it('should not truncate messages of exactly 50 characters', () => {
      const message = 'a'.repeat(50);
      expect(formatSessionLabel(message, SESSION_ID)).toBe(message);
    });

    it('should truncate messages longer than 50 characters with an ellipsis', () => {
      const message = 'a'.repeat(51);
      expect(formatSessionLabel(message, SESSION_ID)).toBe(`${'a'.repeat(50)}...`);
    });

    it('should truncate long real-world messages to 53 characters total', () => {
      const message =
        'What is the best way to structure a large React application with multiple teams?';
      const label = formatSessionLabel(message, SESSION_ID);
      expect(label).toBe(`${message.slice(0, 50)}...`);
      expect(label.length).toBe(53);
    });
  });
});
