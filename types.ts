
export interface ParsedQuestion {
  id: number;
  questionNumber: string;
  subject?: string;
  examYear?: string;
  questionImage?: string;
  questionImageAlignment?: 'left' | 'center' | 'right';
  questionText: string;
  isVerified?: boolean;
  choices: {
    1: string;
    2: string;
    3: string;
    4: string;
    5?: string; // 5지 선다 지원을 위한 선택적 필드
  };
  correctAnswer: number;
  explanation: string;
  userAnswer?: number;
}

export interface FileData {
  file: File;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

export type ProcessingStatus = 'IDLE' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
export const ProcessingStatus = {
  IDLE: 'IDLE',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const;

export interface UploadedFileRecord {
  id: string;
  name: string;
  questionCount: number;
  data: ParsedQuestion[];
}

export interface AudioInfo {
  questionId: number;
  type: 'question' | 'explanation' | 'feedback';
}