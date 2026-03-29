// src/utils/tokenize
import { RawLine } from '../types';

export const uid = () => crypto.randomUUID();

export function tokenizeByLine(raw: string, oldId?: string): RawLine {  
  const leading = raw.match(/^[ \t]*/)?.[0] ?? '';

  return {
    id: oldId ?? uid(),
    raw,
    leading
  }
} 

export function initialTokenize(content: string): RawLine[] {
  const raws = content.split('\n')

  return raws.map((raw) => tokenizeByLine(raw))
}
