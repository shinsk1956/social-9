



import { GoogleGenAI, Type } from "@google/genai";
import { FileData, ParsedQuestion } from "../types";

const SYSTEM_INSTRUCTION = `
당신은 자격증 시험 기출문제 분석 및 해설 전문가입니다. 
업로드된 파일(이미지, PDF 등)이나 텍스트를 분석하여 문제, 보기(4지 또는 5지 선다), 정답, 해설, 과목 정보를 구조화된 JSON 데이터로 추출해야 합니다.

[분석 및 해설 작성 지침]
1. **정확한 텍스트 추출**: 'questionText' 필드에는 문제의 모든 텍스트를 원본 그대로, **단 한 글자도 빠짐없이** 포함해야 합니다. 괄호 안의 조건문 '(단, ...)' 등 모든 내용을 정확하게 추출하십시오. 절대로 텍스트를 요약하거나 임의로 수정하지 마십시오.
2. **문제 유형 파악**: 4지/5지 선다형을 파악하여 'choice5' 필드를 처리하십시오.
3. **정답 및 해설**: 전문가 지식으로 정답을 확정하고, 상세한 해설(핵심 풀이, 선택지 분석)을 작성하십시오.
4. **과목/년도**: 문제지에 있는 과목명과 년도 정보를 정확히 기입하십시오.
5. **누락 금지**: 요청된 범위 내의 모든 문제를 하나도 빠짐없이 추출해야 합니다. 요약하거나 건너뛰지 마십시오.

[출력 준수사항]
반드시 JSON 스키마 포맷을 준수하십시오.
`;

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      questionNumber: { type: Type.STRING },
      subject: { type: Type.STRING },
      examYear: { type: Type.STRING },
      questionText: { type: Type.STRING },
      choice1: { type: Type.STRING },
      choice2: { type: Type.STRING },
      choice3: { type: Type.STRING },
      choice4: { type: Type.STRING },
      choice5: { type: Type.STRING, nullable: true }, // 5지 선다용
      correctAnswer: { type: Type.INTEGER },
      explanation: { type: Type.STRING },
    },
    required: ["questionNumber", "questionText", "correctAnswer", "explanation"],
  },
};

const cleanAndParseJSON = (text: string) => {
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(clean); } catch (e) {
    if (clean.startsWith('[')) {
      const lastTerminator = clean.lastIndexOf('},');
      if (lastTerminator !== -1) {
        try { return JSON.parse(clean.substring(0, lastTerminator + 1) + ']'); } catch (re) {}
      }
    }
    throw e;
  }
};

const getCleanText = (text: string) => {
  if (!text) return "";
  return text.replace(/^(\d+[\.\)\s]+)/, '').trim();
};

const sanitizeSubject = (subject: any): string => {
  if (!subject || typeof subject !== 'string') return "과목없음";
  const cleaned = subject.replace(/[\r\n\t]/g, " ").trim();
  if (cleaned.length > 30 || cleaned.length < 1) return "분류 필요";
  return cleaned;
};

export const analyzeExamData = async (questionFiles: FileData[], answerFiles: FileData[]): Promise<ParsedQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const fileParts: any[] = [];
  questionFiles.forEach(f => fileParts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } }));
  answerFiles.forEach(f => fileParts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } }));
  
  let allQuestions: ParsedQuestion[] = [];
  let nextStartNum = 1;
  let isFinished = false;
  let loopCount = 0;
  const BATCH_SIZE = 40; // 한 번에 추출할 문제 수 증가 (정확도 향상)
  const MAX_LOOPS = 15; // 최대 반복 횟수 (약 600문제 제한)

  // 순차적 배포 추출 (Batch Processing)
  while (!isFinished && loopCount < MAX_LOOPS) {
    loopCount++;
    console.log(`[ExamAI] Batch extraction: Starting from question ${nextStartNum}`);

    const promptText = `
      문서 내용 중 **${nextStartNum}번 문제**부터 시작하여 순서대로 최대 ${BATCH_SIZE}개의 문제를 추출해줘.
      
      [필수 조건]
      1. **시작점 엄수**: 반드시 **문제 번호 ${nextStartNum}번**부터 추출을 시작해야 합니다.
      2. **종료 조건**: 문서에서 더 이상 다음 문제(예: ${nextStartNum}번, ${nextStartNum + 1}번...)를 찾을 수 없을 때만, 오직 그 때만 빈 배열 []을 반환하십시오. 아직 문제가 남아있다면 절대 빈 배열을 반환해서는 안 됩니다.
      3. **중복 방지**: ${nextStartNum}번 이전의 문제는 절대 포함하지 마십시오.
      4. **순서 및 누락 금지**: 문제를 건너뛰지 말고 번호 순서대로 추출해야 합니다. 문서의 끝까지 모든 문제를 분석했는지 다시 한번 확인하고, 남은 문제가 있다면 절대로 누락하지 마십시오. 모든 문제를 추출하는 것이 매우 중요합니다.
      5. **정확성**: 각 문제의 과목명, 해설, **전체 문제 텍스트(괄호 안 내용 포함)** 등을 충실히 작성하십시오.
    `;
    
    const parts = [{ text: promptText }, ...fileParts];

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts },
        config: { 
          systemInstruction: SYSTEM_INSTRUCTION, 
          responseMimeType: "application/json", 
          responseSchema: RESPONSE_SCHEMA 
        },
      });

      const rawData = cleanAndParseJSON(response.text);

      if (!Array.isArray(rawData) || rawData.length === 0) {
        console.log("[ExamAI] No more questions found.");
        isFinished = true;
        break;
      }

      // 유효성 검사: 요청한 번호보다 작은 번호가 오면 필터링 (환각 방지)
      const validBatch = rawData.filter((item: any) => {
        const qNum = parseInt(item.questionNumber.replace(/[^0-9]/g, ''));
        return !isNaN(qNum) && qNum >= nextStartNum;
      });

      if (validBatch.length === 0) {
        console.log("[ExamAI] No valid questions in batch.");
        isFinished = true;
        break;
      }
      
      // 번호순 정렬
      validBatch.sort((a: any, b: any) => {
         const nA = parseInt(a.questionNumber.replace(/[^0-9]/g, ''));
         const nB = parseInt(b.questionNumber.replace(/[^0-9]/g, ''));
         return nA - nB;
      });

      const parsedBatch = validBatch.map((item: any, index: number) => ({
        id: Date.now() + index + Math.floor(Math.random() * 1000000),
        questionNumber: item.questionNumber.replace(/[^0-9]/g, '') || String(nextStartNum + index),
        subject: sanitizeSubject(item.subject),
        examYear: item.examYear || "",
        questionText: getCleanText(item.questionText) || item.questionText,
        isVerified: true,
        questionImageAlignment: 'center' as const,
        choices: { 
          1: item.choice1 || "", 
          2: item.choice2 || "", 
          3: item.choice3 || "", 
          4: item.choice4 || "",
          5: item.choice5 || "" 
        },
        correctAnswer: item.correctAnswer,
        explanation: item.explanation,
      }));

      allQuestions = [...allQuestions, ...parsedBatch];
      
      // 다음 시작 번호 계산 (마지막 문제 번호 + 1)
      const lastItem = validBatch[validBatch.length - 1];
      const lastNum = parseInt(lastItem.questionNumber.replace(/[^0-9]/g, ''));
      nextStartNum = lastNum + 1;

    } catch (err) {
      console.error("[ExamAI] Batch extraction failed:", err);
      // 에러 발생 시 중단하여 무한 루프나 부분 데이터 오염 방지
      isFinished = true;
    }
  }

  return allQuestions;
};

export const analyzeRawText = async (text: string): Promise<ParsedQuestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `다음 텍스트에서 4지 또는 5지 선다 문제를 추출하고 전문가 해설을 포함해줘: \n\n${text}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const rawData = cleanAndParseJSON(response.text);
  // FIX: Added a const assertion for `questionImageAlignment` to fix a type error where
  // the literal 'center' was being incorrectly inferred as `string`.
  return rawData.map((item: any, index: number): ParsedQuestion => ({
    id: Date.now() + index + Math.floor(Math.random() * 1000000),
    questionNumber: item.questionNumber.replace(/[^0-9]/g, '') || String(index + 1),
    subject: sanitizeSubject(item.subject),
    examYear: item.examYear || "",
    questionText: getCleanText(item.questionText) || item.questionText,
    isVerified: true,
    questionImageAlignment: 'center' as const,
    choices: { 
      1: item.choice1 || "", 
      2: item.choice2 || "", 
      3: item.choice3 || "", 
      4: item.choice4 || "",
      5: item.choice5 || ""
    },
    correctAnswer: item.correctAnswer,
    explanation: item.explanation,
  }));
};
