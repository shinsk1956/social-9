import React, { useMemo } from 'react';
import { UploadedFileRecord, ParsedQuestion } from '../types';

interface StatsModalProps {
  data: UploadedFileRecord[];
  onClose: () => void;
  examRecordId?: string;
  questions?: ParsedQuestion[];
  onStartDojo?: () => void;
}

interface SubjectStat {
  total: number;
  solved: number;
  correct: number;
}

const StatsModal: React.FC<StatsModalProps> = ({ data, onClose, examRecordId, questions, onStartDojo }) => {
  const stats = useMemo(() => {
    const isExamResult = !!examRecordId;
    const questionsToAnalyze = questions ? questions : data.flatMap(f => f.data);

    let totalQuestions = 0;
    let solvedQuestions = 0;
    let correctAnswers = 0;
    
    // 과목별 통계: { 과목명: { total, solved, correct } }
    const subjectStats: Record<string, SubjectStat> = {};

    questionsToAnalyze.forEach(q => {
      totalQuestions++;
      const subject = q.subject?.trim() || '기타 과목';

      if (!subjectStats[subject]) {
        subjectStats[subject] = { total: 0, solved: 0, correct: 0 };
      }
      subjectStats[subject].total++;

      if (q.userAnswer !== undefined) {
        solvedQuestions++;
        subjectStats[subject].solved++;
        if (q.userAnswer === q.correctAnswer) {
          correctAnswers++;
          subjectStats[subject].correct++;
        }
      }
    });

    const overallScore = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const progressRate = totalQuestions > 0 ? Math.round((solvedQuestions / totalQuestions) * 100) : 0;

    return {
      totalQuestions,
      solvedQuestions,
      correctAnswers,
      overallScore,
      progressRate,
      subjectStats
    };
  }, [data, questions, examRecordId]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 60) return 'text-indigo-600 bg-indigo-50 border-indigo-200';
    return 'text-red-500 bg-red-50 border-red-200';
  };
  
  const getScoreTextColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-indigo-500';
    return 'text-red-500';
  };

  const getBarColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-indigo-500';
    return 'bg-red-500';
  };

  const handleStartDojo = () => {
    if (onStartDojo) {
      onStartDojo();
    }
    onClose();
  };
  
  const isExamResult = !!examRecordId;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}>
      <div 
        className="bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl border border-white/50" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-md z-10 px-8 py-6 border-b flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-xl">
              {isExamResult ? '🏆' : '📊'}
            </div>
            <h2 className="text-2xl font-black text-slate-800">
              {isExamResult ? '시험 결과' : '학습 분석 리포트'}
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-8 space-y-8">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 flex flex-col items-center justify-center text-center">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">총 학습 진행률</span>
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path className="text-slate-200" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                  <path className="text-indigo-600 transition-all duration-1000 ease-out" strokeDasharray={`${stats.progressRate}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-black text-slate-800">{stats.progressRate}%</span>
                  <span className="text-[10px] font-bold text-slate-400">{stats.solvedQuestions} / {stats.totalQuestions}</span>
                </div>
              </div>
            </div>

            <div className={`rounded-3xl p-6 border flex flex-col items-center justify-center text-center ${getScoreColor(stats.overallScore)}`}>
              <span className="text-xs font-bold opacity-70 uppercase tracking-widest mb-4">
                {isExamResult ? '최종 점수' : '현재 종합 점수'}
              </span>
              <span className="text-6xl font-black mb-2">{stats.overallScore}점</span>
              <span className="text-sm font-bold opacity-80">
                {stats.correctAnswers}문제 정답 / {stats.totalQuestions}문제
              </span>
            </div>

            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 flex flex-col justify-center">
              <h3 className="text-sm font-black text-slate-800 mb-4">학습 피드백</h3>
              {stats.solvedQuestions === 0 ? (
                <p className="text-sm text-slate-500 font-medium">아직 푼 문제가 없습니다.<br/>첫 문제를 풀어보세요!</p>
              ) : stats.overallScore >= 60 ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-emerald-600">🎉 합격 안정권입니다!</p>
                  <p className="text-xs text-slate-500">현재 페이스를 유지하며 틀린 문제 위주로 복습하세요.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-red-500">⚠️ 분발이 필요합니다!</p>
                  <p className="text-xs text-slate-500">과락을 피하기 위해 취약한 과목을 집중 공략하세요.</p>
                </div>
              )}
            </div>
          </div>

          {/* Subject Breakdown */}
          <div>
            <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2">
              <span>과목별 성취도</span>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg">Subject Analysis</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(stats.subjectStats).map(([subject, subStat]: [string, SubjectStat]) => {
                const subScore = subStat.total > 0 ? Math.round((subStat.correct / subStat.total) * 100) : 0;
                const subProgress = subStat.total > 0 ? Math.round((subStat.solved / subStat.total) * 100) : 0;
                const circumference = 2 * Math.PI * 16;
                const scoreOffset = circumference - (subScore / 100) * circumference;

                return (
                  <div key={subject} className="bg-white p-5 rounded-3xl border border-slate-100 flex items-center gap-5 transition-all hover:shadow-lg hover:border-indigo-100">
                    <div className="relative w-24 h-24 shrink-0">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                        <path className="text-slate-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                        <path 
                          className={`${getScoreTextColor(subScore)} transition-all duration-1000 ease-out`} 
                          strokeDasharray="100, 100"
                          strokeDashoffset={100 - subScore}
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {subStat.solved > 0 ? (
                           <>
                            <span className={`text-3xl font-black ${getScoreTextColor(subScore)}`}>{subScore}</span>
                            <span className="text-[10px] font-bold text-slate-400">점</span>
                           </>
                        ) : (
                          <span className="text-lg font-black text-slate-300">미응시</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-grow space-y-3">
                      <h4 className="font-black text-slate-800 truncate text-base">{subject}</h4>
                      <div>
                        <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                          <span>학습 진행률</span>
                          <span>{subProgress}% ({subStat.solved}/{subStat.total})</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${subProgress}%` }} />
                        </div>
                      </div>
                       {subStat.solved > 0 && (
                         <div>
                            <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                                <span>정답률</span>
                                <span>{subScore}% ({subStat.correct}/{subStat.total})</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${getBarColor(subScore)}`} style={{ width: `${subScore}%` }}/>
                            </div>
                        </div>
                       )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {isExamResult && onStartDojo && (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-md z-10 p-4 border-t mt-4 flex justify-end gap-3">
             <button onClick={onClose} className="px-6 py-3 bg-slate-100 text-slate-600 rounded-full font-bold hover:bg-slate-200 transition-colors">
              닫기
             </button>
             <button onClick={handleStartDojo} className="px-6 py-3 bg-orange-500 text-white rounded-full font-bold hover:bg-orange-600 transition-colors shadow-lg shadow-orange-200">
              도장깨기 시작
             </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatsModal;
