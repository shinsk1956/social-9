import React, { useState, useRef, ClipboardEvent, useEffect } from 'react';
import { ParsedQuestion, AudioInfo } from '../types';

interface QuestionCardProps {
  question: ParsedQuestion;
  onUpdate: (id: number, updated: ParsedQuestion) => void;
  onDelete: (id: number) => void;
  isAdmin?: boolean;
  activeAudioInfo: AudioInfo | null;
  setActiveAudioInfo: React.Dispatch<React.SetStateAction<AudioInfo | null>>;
  isExamMode: boolean;
  showAnswers: boolean;
}

const QuestionCard: React.FC<QuestionCardProps> = ({ 
  question, 
  onUpdate, 
  onDelete, 
  isAdmin, 
  activeAudioInfo, 
  setActiveAudioInfo,
  isExamMode,
  showAnswers
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localQ, setLocalQ] = useState(question);
  
  const audioContextRef = useRef<AudioContext | null>(null);

  const isPlayingQuestion = activeAudioInfo?.questionId === question.id && activeAudioInfo?.type === 'question';
  const isPlayingExplanation = activeAudioInfo?.questionId === question.id && activeAudioInfo?.type === 'explanation';

  useEffect(() => { 
    if (!isEditing) {
      setLocalQ(question); 
    }
  }, [question, isEditing]);

  // Warm-up: Initialize speech engine early to prevent cold-start delay
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Cleanup effect to stop speech synthesis when the component unmounts
  useEffect(() => { 
    return () => {
      if (activeAudioInfo?.questionId === question.id) {
        window.speechSynthesis.cancel();
      }
    };
  }, [question.id, activeAudioInfo]);

  const getAudioContext = async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    return audioContextRef.current;
  };

  const playFeedbackSound = async (isCorrect: boolean) => {
    try {
      const ctx = await getAudioContext();
      const now = ctx.currentTime;
      
      if (isCorrect) {
        const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
        const times = [0, 0.2, 0.4];

        frequencies.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          const startTime = now + times[i];
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.2, startTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);
          
          osc.start(startTime);
          osc.stop(startTime + 0.8);
        });
      } else {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'triangle'; 
        osc.frequency.setValueAtTime(440, now);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.6);
      }
    } catch (e) {
      console.warn("Audio feedback failed", e);
    }
  };

  const choice5Text = localQ.choices[5];
  const hasOption5 = choice5Text !== undefined && choice5Text !== null && choice5Text.trim().length > 0;
  const availableChoices = isEditing ? [1, 2, 3, 4, 5] : (hasOption5 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4]);

  const splitTextIntoChunks = (text: string): string[] => {
    const chunks = text.match(/[^.?!]+[.?!]+|[^.?!]+$/g);
    if (!chunks) return [text];
    return chunks.map(c => c.trim()).filter(c => c.length > 0);
  };

  const cleanTextForTTS = (text: string): string => {
    if (!text) return '';
    // 밑줄, 별표, 해시, 괄호 등 음성 출력에 불필요한 특수 기호를 공백으로 치환
    return text.replace(/[_*#\[\]{}()~`]/g, ' ');
  };

  const playTTS = (textToSpeak: string, type: 'question' | 'explanation') => {
    if (activeAudioInfo?.questionId === question.id && activeAudioInfo?.type === type) {
      window.speechSynthesis.cancel();
      setActiveAudioInfo(null);
      return;
    }

    window.speechSynthesis.cancel();
    setActiveAudioInfo({ questionId: question.id, type });
    
    const cleanedText = cleanTextForTTS(textToSpeak);

    const segmentTextByLanguage = (text: string): { text: string; lang: 'en-US' | 'ko-KR' }[] => {
      if (!text) return [];

      const parts = text.match(/([ㄱ-ㅎㅏ-ㅣ가-힣]+|[^ㄱ-ㅎㅏ-ㅣ가-힣]+)/g) || [];
      const segments: { text: string; lang: 'en-US' | 'ko-KR' }[] = [];

      for (const part of parts) {
        if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(part)) {
          segments.push({ text: part, lang: 'ko-KR' });
        } else if (/[a-zA-Z]/.test(part)) {
          segments.push({ text: part, lang: 'en-US' });
        } else { // Punctuation, numbers, spaces
          if (segments.length > 0) {
            segments[segments.length - 1].text += part;
          } else {
            segments.push({ text: part, lang: 'ko-KR' });
          }
        }
      }
      
      if (segments.length < 2) return segments;

      const consolidated = [segments[0]];
      for (let i = 1; i < segments.length; i++) {
        const current = segments[i];
        const last = consolidated[consolidated.length - 1];
        if (current.lang === last.lang) {
          last.text += current.text;
        } else {
          consolidated.push(current);
        }
      }
      return consolidated;
    };

    const segments = segmentTextByLanguage(cleanedText);
    const voices = window.speechSynthesis.getVoices();

    if (segments.length === 0) {
      setActiveAudioInfo(null);
      return;
    }

    const utterances = segments.flatMap(segment => {
        const sentences = splitTextIntoChunks(segment.text);
        return sentences.map(sentence => {
            const utterance = new SpeechSynthesisUtterance(sentence);
            const targetLang = segment.lang;
            const voice = voices.find(v => v.lang === targetLang && v.name.includes('Google')) || voices.find(v => v.lang === targetLang) || voices.find(v => v.lang.startsWith(targetLang.split('-')[0])) || null;
            utterance.lang = targetLang;
            if (voice) utterance.voice = voice;
            utterance.rate = 1.2; 

            utterance.onerror = (event) => {
              console.error('SpeechSynthesisUtterance.onerror', event);
            };
            return utterance;
        });
    });

    if (utterances.length > 0) {
      utterances[utterances.length - 1].onend = () => {
         setActiveAudioInfo((current) => {
           if (current?.questionId === question.id && current?.type === type) {
             return null;
           }
           return current;
         });
      };
    } else {
      setActiveAudioInfo(null);
    }
    
    utterances.forEach(utterance => window.speechSynthesis.speak(utterance));
  };

  const handleChoiceClick = (choiceNum: number) => {
    if (isEditing || (question.userAnswer !== undefined && !isAdmin && !isExamMode)) return;
    const isCorrect = choiceNum === question.correctAnswer;
    onUpdate(question.id, { ...question, userAnswer: choiceNum });
    if (!isExamMode) {
      playFeedbackSound(isCorrect);
    }
  };

  const toggleQuestionAudio = () => {
    if (isEditing) return;
    const choicesText = availableChoices.map(n => `${n}, ${localQ.choices[n as 1|2|3|4|5]}`).join('. ');
    // "보기" 단어를 제거하여 더 자연스러운 음성 출력
    const fullText = `문제 ${localQ.questionNumber}. ${localQ.questionText}. ${choicesText}`;
    playTTS(fullText, 'question');
  };

  const toggleExplanationAudio = () => {
    if (isEditing) return;
    playTTS(localQ.explanation, 'explanation');
  };

  const handleSave = () => {
    onUpdate(question.id, localQ);
    setIsEditing(false);
  };

  const handleChange = (field: keyof ParsedQuestion | 'choices', value: any, choiceIdx?: number) => {
    if (field === 'choices' && choiceIdx) {
      setLocalQ(prev => ({ ...prev, choices: { ...prev.choices, [choiceIdx]: value } }));
    } else if (field === 'questionText') {
      setLocalQ(prev => ({ ...prev, questionText: value, isVerified: true }));
    } else {
      setLocalQ(prev => ({ ...prev, [field]: value }));
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!isEditing) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => handleChange('questionImage', reader.result as string);
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const toggleVerification = () => {
    const updatedQuestion = { ...question, isVerified: !(question.isVerified ?? true) };
    onUpdate(question.id, updatedQuestion);
  };

  const isSolved = question.userAnswer !== undefined;
  const isCorrect = question.userAnswer === question.correctAnswer;
  const isVerified = localQ.isVerified ?? true;

  const explanationVisible = isEditing || isAdmin || (showAnswers && isSolved);

  return (
    <div 
      id={`question-${question.id}`}
      onPaste={handlePaste}
      className={`relative p-8 rounded-[2.5rem] border-2 transition-all ${
        (isSolved && showAnswers)
          ? (isCorrect ? 'border-emerald-100 bg-emerald-50/30' : 'border-red-100 bg-red-50/30') 
          : 'border-slate-100 bg-white hover:border-indigo-200'
      } ${isEditing ? 'ring-4 ring-indigo-50 border-indigo-200 shadow-2xl z-10' : ''}`}
    >
      <div className="flex justify-between items-start mb-6">
        <div className="flex gap-4 items-center flex-grow">
          {isEditing ? (
            <div className="flex gap-2 items-center flex-wrap">
              <div className="flex flex-col">
                <label className="text-[10px] font-black text-slate-400 mb-1">번호</label>
                <input 
                  className="w-16 h-10 rounded-xl bg-slate-900 text-white text-center font-black outline-none focus:ring-2 ring-indigo-500"
                  value={localQ.questionNumber}
                  onChange={(e) => handleChange('questionNumber', e.target.value)}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] font-black text-slate-400 mb-1">과목</label>
                <input 
                  className="px-3 h-10 rounded-xl border-2 border-slate-100 font-bold text-sm outline-none focus:ring-2 ring-indigo-500 text-indigo-600"
                  value={localQ.subject || ''}
                  onChange={(e) => handleChange('subject', e.target.value)}
                  placeholder="과목명"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] font-black text-slate-400 mb-1">연도</label>
                <input 
                  className="px-3 h-10 rounded-xl border-2 border-slate-100 font-bold text-sm outline-none focus:ring-2 ring-indigo-500 text-slate-600"
                  value={localQ.examYear || ''}
                  onChange={(e) => handleChange('examYear', e.target.value)}
                  placeholder="2024년 1회"
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-3 items-center">
              <span className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-lg">
                {localQ.questionNumber}
              </span>
              <div>
                <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest block mb-0.5">
                  {localQ.subject || '과목없음'}
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {localQ.examYear || '기출년도 미상'}
                </span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex gap-2 shrink-0">
           {!isExamMode && (
             <button 
               onClick={toggleQuestionAudio}
               className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isPlayingQuestion ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
             >
               {isPlayingQuestion ? (
                  <span className="animate-pulse font-bold">❚❚</span>
               ) : (
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
               )}
             </button>
           )}
           {isAdmin && (
             <>
               <button 
                 onClick={toggleVerification}
                 title="문제 검토 필요"
                 className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${!isVerified ? 'bg-yellow-400 text-white' : 'bg-slate-100 text-slate-400 hover:bg-yellow-50 hover:text-yellow-500'}`}
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
               </button>
               <button 
                 onClick={() => setIsEditing(!isEditing)}
                 className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isEditing ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
               </button>
               <button 
                 onClick={() => onDelete(question.id)}
                 className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
               </button>
             </>
           )}
        </div>
      </div>

      <div className="mb-6">
        {isEditing ? (
          <div className="flex flex-col">
            <label className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">문제 내용</label>
            <textarea 
              className={`w-full p-4 border-2 rounded-xl font-bold focus:ring-2 outline-none min-h-[120px] text-lg leading-relaxed transition-colors ${
                !isVerified ? 'bg-yellow-50 border-yellow-200 ring-yellow-100' : 'bg-slate-50 border-slate-100 ring-indigo-100'
              }`}
              value={localQ.questionText}
              onChange={(e) => handleChange('questionText', e.target.value)}
              placeholder="문제를 입력하세요"
            />
          </div>
        ) : (
          <h3 className="text-xl font-bold text-slate-800 leading-relaxed whitespace-pre-wrap">
            {localQ.questionText}
          </h3>
        )}
      </div>

      <div className="mb-8 empty:hidden">
        {isEditing ? (
          <div className="flex flex-col">
            <label className="text-[10px] font-black text-slate-400 mb-1 uppercase tracking-widest">문제 이미지 (클립보드 붙여넣기 가능)</label>
            {localQ.questionImage ? (
              <>
                <div className="relative group w-fit mx-auto">
                  <img src={localQ.questionImage} alt="question" className="max-h-80 rounded-xl shadow-md border" />
                  <button 
                    onClick={() => handleChange('questionImage', undefined)}
                    className="absolute -top-3 -right-3 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex justify-center items-center gap-2 mt-4 p-1 bg-slate-100 rounded-xl w-fit mx-auto">
                   {(['left', 'center', 'right'] as const).map(align => (
                       <button
                           key={align}
                           onClick={() => handleChange('questionImageAlignment', align)}
                           className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${localQ.questionImageAlignment === align ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-white'}`}
                       >
                           {align.charAt(0).toUpperCase() + align.slice(1)}
                       </button>
                   ))}
                </div>
              </>
            ) : (
              <div className="w-full h-32 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-300">
                <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                <span className="text-xs font-bold">붙여넣기로 이미지 추가</span>
              </div>
            )}
          </div>
        ) : (
          localQ.questionImage && (
            <div className={`flex w-full ${
              localQ.questionImageAlignment === 'left' ? 'justify-start' :
              localQ.questionImageAlignment === 'right' ? 'justify-end' :
              'justify-center'
            }`}>
              <img src={localQ.questionImage} alt="question" className="max-h-96 rounded-2xl shadow-sm border border-slate-100" />
            </div>
          )
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 mb-8">
        {isEditing && <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">지문 및 정답 설정 {hasOption5 ? '(5지 선다)' : '(4지 선다)'}</label>}
        
        {availableChoices.map((num) => {
          const choiceText = localQ.choices[num as 1|2|3|4|5] || '';
          const isSelected = question.userAnswer === num;
          const isCorrectChoice = num === question.correctAnswer;
          
          let stateClass = 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300';
          if (showAnswers && isSelected) {
            stateClass = isCorrectChoice 
              ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-200' 
              : 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-200';
          } else if (isSolved && showAnswers && isCorrectChoice) {
            stateClass = 'bg-emerald-50 border-emerald-400 text-emerald-700 font-bold ring-2 ring-emerald-200 ring-offset-2';
          } else if (isSelected) {
            stateClass = 'bg-indigo-50 border-indigo-400 text-indigo-700 font-bold ring-2 ring-indigo-200';
          }

          return (
            <div key={num} className="flex gap-2">
              {isEditing ? (
                <div className={`flex-grow flex items-start gap-3 p-3 rounded-2xl border-2 transition-all ${localQ.correctAnswer === num ? 'border-indigo-600 bg-indigo-50/30' : 'border-slate-100 bg-slate-50'}`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm shrink-0 mt-1 ${localQ.correctAnswer === num ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{num}</span>
                  <textarea 
                    className="flex-grow bg-transparent font-bold outline-none text-slate-700 resize-none w-full leading-relaxed"
                    value={choiceText}
                    onChange={(e) => handleChange('choices', e.target.value, num)}
                    placeholder={`${num}번 지문을 입력하세요 (비워두면 숨김)`}
                    rows={1}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = `${target.scrollHeight}px`;
                    }}
                  />
                  <label className="flex items-center gap-2 cursor-pointer mt-1">
                    <span className="text-[10px] font-black text-slate-400">정답</span>
                    <input 
                      type="radio"
                      name={`correct-${question.id}`}
                      checked={localQ.correctAnswer === num}
                      onChange={() => handleChange('correctAnswer', num)}
                      className="w-5 h-5 accent-indigo-600"
                    />
                  </label>
                </div>
              ) : (
                <button
                  onClick={() => handleChoiceClick(num)}
                  disabled={showAnswers && isSolved && !isAdmin}
                  className={`flex-grow p-5 rounded-2xl border-2 text-left transition-all flex items-center gap-4 relative overflow-hidden ${stateClass}`}
                >
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm ${isSelected ? 'bg-white/20' : 'bg-slate-100 text-slate-400'}`}>
                    {num}
                  </span>
                  <span className="font-bold">{choiceText}</span>
                  {isAdmin && isCorrectChoice && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black bg-emerald-600 text-white px-2 py-1 rounded-lg shadow-sm">정답</span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {explanationVisible && (
        <div className={`mt-8 pt-8 border-t border-dashed ${isEditing ? 'border-indigo-200' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">해설 및 오답노트</span>
               {!isExamMode && (
                 <button 
                   onClick={toggleExplanationAudio}
                   className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isPlayingExplanation ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                 >
                   {isPlayingExplanation ? (
                     <span className="animate-pulse font-bold">❚❚</span>
                   ) : (
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                   )}
                 </button>
               )}
             </div>
          </div>
          {isEditing ? (
            <textarea 
              className="w-full p-6 border-2 border-slate-100 rounded-[1.5rem] bg-slate-50 font-bold focus:ring-2 ring-indigo-100 outline-none text-sm leading-relaxed min-h-[140px]"
              value={localQ.explanation}
              onChange={(e) => handleChange('explanation', e.target.value)}
              placeholder="정답 근거 및 상세 해설을 입력하세요"
            />
          ) : (
            <p className="text-sm font-bold text-slate-600 leading-relaxed bg-slate-50/50 p-6 rounded-[1.5rem] border border-slate-100 whitespace-pre-wrap">
              {localQ.explanation || "등록된 해설이 없습니다."}
            </p>
          )}
        </div>
      )}

      {isEditing && (
        <div className="mt-8 flex gap-3 sticky bottom-4">
          <button 
            onClick={handleSave} 
            className="flex-grow py-5 bg-indigo-600 text-white rounded-[2rem] font-black shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
            수정사항 저장하기
          </button>
          <button 
            onClick={() => { setIsEditing(false); setLocalQ(question); }} 
            className="px-10 py-5 bg-slate-200 text-slate-700 rounded-[2rem] font-black hover:bg-slate-300 transition-all"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
};

export default QuestionCard;