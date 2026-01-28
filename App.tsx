import React, { useRef } from 'react';
import Dropzone from './components/Dropzone';
import QuestionCard from './components/QuestionCard';
import StatsModal from './components/StatsModal';
import { FileData, ParsedQuestion, ProcessingStatus, UploadedFileRecord, AudioInfo } from './types';
import { analyzeExamData, analyzeRawText } from './services/geminiService';
import { generateCSV, generateJSON, parseCSV } from './utils/csvHelper';
import * as storage from './services/storageService';

const App: React.FC = () => {
  const [appMode, setAppMode] = React.useState<'USER' | 'ADMIN'>('USER');
  const [status, setStatus] = React.useState<ProcessingStatus>(ProcessingStatus.IDLE);
  
  // 기출문제 데이터 저장소
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFileRecord[]>([]);
  const [isLoaded, setIsLoaded] = React.useState(false);
  
  // 기본 데이터 삭제 여부 상태 (UI 토글용)
  const [defaultsCleared, setDefaultsCleared] = React.useState(false);
  
  // 사용자가 선택한 시험지 ID
  const [selectedUserRecordId, setSelectedUserRecordId] = React.useState<string | null>(null);
  
  // 학습/시험 모드 관리
  const [currentMode, setCurrentMode] = React.useState<'LEARNING' | 'EXAM' | 'RANDOM'>('LEARNING');
  const [randomQuestions, setRandomQuestions] = React.useState<ParsedQuestion[]>([]);
  const [examSubmitted, setExamSubmitted] = React.useState(false);
  const [showExamResultModal, setShowExamResultModal] = React.useState(false);
  const [examTimer, setExamTimer] = React.useState(0);
  
  // 필터 상태
  const [selectedYearFilter, setSelectedYearFilter] = React.useState<string>('ALL');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = React.useState<string>('ALL');
  
  // UI 모달 상태
  const [recordToDelete, setRecordToDelete] = React.useState<string | null>(null);
  const [showStatsModal, setShowStatsModal] = React.useState(false);
  
  // 전체 삭제 모달 상태
  const [showDeleteAllModal, setShowDeleteAllModal] = React.useState(false);

  // 데이터 로딩 및 초기화 로직 통합
  React.useEffect(() => {
    const initializeAppData = async () => {
      let isDefaultsCleared = storage.getDefaultsClearedFlag();
      setDefaultsCleared(isDefaultsCleared);
      let currentFiles = storage.loadUploadedFiles();
      
      // If all data is cleared (user and defaults), restore defaults on next load.
      if (currentFiles.length === 0 && isDefaultsCleared) {
        storage.removeDefaultsClearedFlag();
        isDefaultsCleared = false; 
      }

      if (!isDefaultsCleared) {
        try {
          const manifestRes = await fetch('/manifest.json');
          if (!manifestRes.ok) throw new Error(`Manifest not found: ${manifestRes.status}`);
          
          const fileList: { file: string; name: string }[] = await manifestRes.json();
          if (!Array.isArray(fileList)) throw new Error("Invalid manifest format");

          const existingIds = new Set(currentFiles.map(f => f.id));
          const filesToLoad = fileList.filter(item => !existingIds.has(item.file));

          if (filesToLoad.length > 0) {
            const filePromises = filesToLoad.map(async (item) => {
              try {
                const res = await fetch(`/${item.file}`);
                if (!res.ok) return null;
                const text = await res.text();
                if (text.trim().startsWith('<')) return null;
                const questions = parseCSV(text);
                if (questions.length === 0) return null;
                return {
                  id: item.file,
                  name: item.name,
                  questionCount: questions.length,
                  data: questions
                } as UploadedFileRecord;
              } catch (err) {
                console.error(`Error loading default file ${item.file}:`, err);
                return null;
              }
            });

            const newRecords = (await Promise.all(filePromises)).filter((r): r is UploadedFileRecord => r !== null);
            if (newRecords.length > 0) {
              currentFiles = [...currentFiles, ...newRecords];
            }
          }
        } catch (e) {
          console.error("Critical error loading default data:", e);
        }
      }
      setUploadedFiles(currentFiles);
      setIsLoaded(true);
    };

    initializeAppData();
  }, []);

  React.useEffect(() => {
    if (isLoaded) {
      storage.saveUploadedFiles(uploadedFiles);
    }
  }, [uploadedFiles, isLoaded]);

  React.useEffect(() => {
    let timerInterval: number | undefined;
    const isTimerActive = appMode === 'USER' && (currentMode === 'EXAM' || currentMode === 'RANDOM') && selectedUserRecordId && !examSubmitted;
    if (isTimerActive) {
      timerInterval = window.setInterval(() => {
        setExamTimer(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  }, [appMode, currentMode, selectedUserRecordId, examSubmitted]);

  React.useEffect(() => {
    if (currentMode !== 'EXAM' && currentMode !== 'RANDOM' || !selectedUserRecordId) {
      setExamTimer(0);
    }
  }, [currentMode, selectedUserRecordId]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const [adminViewingRecordId, setAdminViewingRecordId] = React.useState<string | null>(null);
  const [inputMode, setInputMode] = React.useState<'FILE' | 'TEXT' | 'IMPORT'>('FILE');
  const [questionFiles, setQuestionFiles] = React.useState<FileData[]>([]);
  const [answerFiles, setAnswerFiles] = React.useState<FileData[]>([]);
  const [rawTextInput, setRawTextInput] = React.useState('');
  const [retryMode, setRetryMode] = React.useState(false);
  const [retryIds, setRetryIds] = React.useState<Set<number>>(new Set());
  const [showScoreModal, setShowScoreModal] = React.useState(false);
  const [hasDismissedScore, setHasDismissedScore] = React.useState(false);
  const [navPage, setNavPage] = React.useState(0);
  const NAV_PAGE_SIZE = 10;
  const [activeAudioInfo, setActiveAudioInfo] = React.useState<AudioInfo | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const getYearFromRecord = (record: UploadedFileRecord): string => {
    const nameMatch = record.name.match(/^(\d{4})/);
    if (nameMatch) return nameMatch[1];
    if (record.data.length > 0) {
       const qYear = record.data[0].examYear || '';
       const dataMatch = qYear.match(/(\d{4})/);
       if (dataMatch) return dataMatch[1];
    }
    return '기타';
  };
  
  const getSubjectFromRecord = (record: UploadedFileRecord): string => {
    return record.data[0]?.subject || '기타 과목';
  };

  const { uniqueYears, uniqueSubjects, filteredFiles } = React.useMemo(() => {
    const yearsSet = new Set<string>();
    uploadedFiles.forEach(f => { yearsSet.add(getYearFromRecord(f)); });
    const sortedYears = Array.from(yearsSet).sort((a, b) => {
      if (a === '기타') return 1; if (b === '기타') return -1;
      return b.localeCompare(a);
    });
    
    const subjectsSet = new Set<string>();
    uploadedFiles.forEach(f => { subjectsSet.add(getSubjectFromRecord(f)); });
    const sortedSubjects = Array.from(subjectsSet).sort((a,b) => a.localeCompare(b));

    let filtered = uploadedFiles;
    if (selectedYearFilter !== 'ALL') filtered = filtered.filter(f => getYearFromRecord(f) === selectedYearFilter);
    if (selectedSubjectFilter !== 'ALL') filtered = filtered.filter(f => getSubjectFromRecord(f) === selectedSubjectFilter);
    filtered.sort((a, b) => b.name.localeCompare(a.name));

    return { uniqueYears: sortedYears, uniqueSubjects: sortedSubjects, filteredFiles: filtered };
  }, [uploadedFiles, selectedYearFilter, selectedSubjectFilter]);

  const scrollToQuestion = (id: number) => {
    const element = document.getElementById(`question-${id}`);
    if (element) {
      const header = document.querySelector('header');
      const headerHeight = header ? header.offsetHeight : 0;
      const navBar = document.getElementById('question-nav-bar');
      const navBarHeight = navBar ? navBar.offsetHeight : 0;
      const totalOffset = headerHeight + navBarHeight + 20; // 20px for extra space

      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - totalOffset;

      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processFiles = (files: File[]) => Promise.all(files.map(async (file) => ({
    file,
    previewUrl: URL.createObjectURL(file),
    base64: await fileToBase64(file),
    mimeType: file.type,
  })));

  const handleDataImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setStatus(ProcessingStatus.PROCESSING);
    try {
      const promises = Array.from(files).map((file: File) => new Promise<UploadedFileRecord>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;
            const questions = file.name.endsWith('.json') ? JSON.parse(content) : parseCSV(content);
            if (!Array.isArray(questions)) throw new Error("Invalid format");
            resolve({ id: Math.random().toString(36).substr(2, 9), name: file.name.replace(/\.(csv|json)$/i, ''), questionCount: questions.length, data: questions });
          } catch (err) { reject(err); }
        };
        reader.readAsText(file);
      }));
      const results = await Promise.all(promises);
      setUploadedFiles(prev => [...prev, ...results]);
      setStatus(ProcessingStatus.IDLE);
      alert(`${results.length}개의 시험지 파일이 성공적으로 불러와졌습니다.`);
    } catch (err) {
      setStatus(ProcessingStatus.ERROR);
      alert("파일 파싱 중 오류가 발생했습니다.");
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (inputMode === 'FILE' && questionFiles.length === 0) return alert("문제지 파일을 업로드해주세요.");
    setStatus(ProcessingStatus.PROCESSING);
    try {
      const newData = inputMode === 'FILE' ? await analyzeExamData(questionFiles, answerFiles) : await analyzeRawText(rawTextInput);
      const groupedData = newData.reduce((acc, curr) => {
        const subject = curr.subject?.trim() || "기타 과목";
        if (!acc[subject]) acc[subject] = [];
        acc[subject].push(curr);
        return acc;
      }, {} as Record<string, ParsedQuestion[]>);
      const newRecords = Object.entries(groupedData).map(([subject, questions]) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: inputMode === 'FILE' ? `${questionFiles[0].file.name.split('.')[0]} - ${subject}` : `AI 분석 - ${subject}`,
        questionCount: questions.length,
        data: questions
      }));
      setUploadedFiles(prev => [...prev, ...newRecords]);
      setStatus(ProcessingStatus.IDLE);
      setQuestionFiles([]);
      setAnswerFiles([]);
      setRawTextInput('');
      alert(`분석 완료! ${newRecords.length}개의 과목별 시험지가 생성되었습니다.`);
    } catch (err) {
      console.error(err);
      setStatus(ProcessingStatus.ERROR);
      alert("AI 분석 중 오류가 발생했습니다.");
    }
  };

  const loadDefaultData = async () => {
    setStatus(ProcessingStatus.PROCESSING);
    try {
      const manifestRes = await fetch('/manifest.json');
      if (!manifestRes.ok) throw new Error(`Manifest not found: ${manifestRes.status}`);
      
      const fileList: { file: string; name: string }[] = await manifestRes.json();
      if (!Array.isArray(fileList)) throw new Error("Invalid manifest format");
  
      const filePromises = fileList.map(async (item) => {
        try {
          const res = await fetch(`/${item.file}`);
          if (!res.ok) return null;
          const text = await res.text();
          if (text.trim().startsWith('<')) return null;
          const questions = parseCSV(text);
          if (questions.length === 0) return null;
          return {
            id: item.file,
            name: item.name,
            questionCount: questions.length,
            data: questions
          } as UploadedFileRecord;
        } catch (err) {
          console.error(`Error loading default file ${item.file}:`, err);
          return null;
        }
      });
  
      const defaultRecords = (await Promise.all(filePromises)).filter((r): r is UploadedFileRecord => r !== null);
      
      setUploadedFiles(defaultRecords);
      alert(`${defaultRecords.length}개의 기본 시험지로 초기화되었습니다.`);
      
      storage.removeDefaultsClearedFlag();
      setDefaultsCleared(false);
      setStatus(ProcessingStatus.IDLE);
    } catch (e) {
      console.error("Critical error loading default data:", e);
      setStatus(ProcessingStatus.ERROR);
      alert("기본 데이터 로딩 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteAllClick = () => setShowDeleteAllModal(true);

  const confirmDeleteAll = () => {
    setShowDeleteAllModal(false);
    setAdminViewingRecordId(null);
    setSelectedUserRecordId(null);
    loadDefaultData();
  };

  const handleRestoreDefaults = () => {
    if (confirm("기본 데이터를 다시 로드하시겠습니까?")) {
      storage.removeDefaultsClearedFlag();
      window.location.reload();
    }
  };

  const handleDownloadAllData = () => {
    if (uploadedFiles.length === 0) return alert("다운로드할 데이터가 없습니다.");
    uploadedFiles.forEach((record, i) => setTimeout(() => generateCSV(record.data), i * 300));
    alert(`${uploadedFiles.length}개의 CSV 파일 다운로드가 시작됩니다.`);
  };

  const requestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    setRecordToDelete(id);
  };

  const confirmDeleteRecord = () => {
    if (!recordToDelete) return;
    setUploadedFiles(prev => prev.filter(f => f.id !== recordToDelete));
    if (adminViewingRecordId === recordToDelete) setAdminViewingRecordId(null);
    if (selectedUserRecordId === recordToDelete) setSelectedUserRecordId(null);
    setRecordToDelete(null);
  };

  const handleUpdateQuestion = React.useCallback((id: number, updated: ParsedQuestion) => {
    if (currentMode === 'RANDOM') {
      setRandomQuestions(prev => prev.map(q => q.id === id ? updated : q));
    } else {
      setUploadedFiles(prev => prev.map(f => f.data.some(q => q.id === id) ? { ...f, data: f.data.map(mq => mq.id === id ? updated : mq) } : f));
    }
  }, [currentMode]);

  const handleExamSubmit = () => {
    setExamSubmitted(true);
    setShowExamResultModal(true);
  };

  const activeRecordId = appMode === 'ADMIN' ? adminViewingRecordId : selectedUserRecordId;

  const currentQuestions = React.useMemo(() => {
    if (appMode === 'USER' && currentMode === 'RANDOM') {
      return randomQuestions;
    }
    if (!activeRecordId) return [];
  
    if (retryMode && appMode === 'USER') {
      const allQuestions = uploadedFiles.flatMap(f => f.data);
      const dojoQuestions = allQuestions.filter(q => retryIds.has(q.id));
      dojoQuestions.sort((a,b) => parseInt(a.questionNumber) - parseInt(b.questionNumber));
      return dojoQuestions;
    }
  
    const base = uploadedFiles.find(f => f.id === activeRecordId)?.data || [];
    return base;
  }, [uploadedFiles, activeRecordId, retryMode, appMode, retryIds, currentMode, randomQuestions]);

  const navItems = React.useMemo(() => currentQuestions.slice(navPage * NAV_PAGE_SIZE, (navPage + 1) * NAV_PAGE_SIZE), [currentQuestions, navPage]);
  const totalCount = currentQuestions.length;
  const answeredCount = currentQuestions.filter(q => q.userAnswer !== undefined).length;
  const score = totalCount > 0 ? Math.round((currentQuestions.filter(q => q.userAnswer === q.correctAnswer).length / totalCount) * 100) : 0;

  const getScoreFeedback = (s: number) => {
    if (s >= 80) return { message: "합격 하세요!", emoji: "🏆", color: "text-emerald-600" };
    if (s >= 60) return { message: "노력 하세요!", emoji: "💪", color: "text-indigo-600" };
    if (s >= 40) return { message: "열공 하세요!", emoji: "🔥", color: "text-orange-600" };
    return { message: "5번만 풀어보세요!", emoji: "📚", color: "text-red-600" };
  };

  const feedback = getScoreFeedback(score);

  const startDojo = () => {
    const wrong = currentQuestions.filter(q => q.userAnswer !== undefined && q.userAnswer !== q.correctAnswer);
    if (wrong.length === 0) return alert("틀린 문제가 없습니다!");
    
    setRetryIds(new Set(wrong.map(q => q.id)));
  
    setUploadedFiles(prev => prev.map(record => {
      const recordHasWrongQuestions = record.data.some(q => wrong.some(wq => wq.id === q.id));
      if (!recordHasWrongQuestions) {
        return record;
      }
      const newData = record.data.map(q => {
        const isWrong = wrong.some(wq => wq.id === q.id);
        return isWrong ? { ...q, userAnswer: undefined } : q;
      });
      return { ...record, data: newData };
    }));
  
    setRetryMode(true);
    setShowScoreModal(false);
    setShowExamResultModal(false);
    setHasDismissedScore(false);
    setNavPage(0);
    setCurrentMode('LEARNING');
  };

  const handleRetryDojo = () => {
    const stillWrong = currentQuestions.filter(q => q.userAnswer !== undefined && q.userAnswer !== q.correctAnswer);

    if (stillWrong.length === 0) {
      alert("축하합니다! 모든 오답 문제를 정복했습니다.");
      setRetryMode(false);
      setRetryIds(new Set());
      setSelectedUserRecordId(null);
      return;
    }

    const newRetryIds = new Set(stillWrong.map(q => q.id));
    setRetryIds(newRetryIds);

    setUploadedFiles(prev => 
      prev.map(record => {
        if (record.id === selectedUserRecordId) {
          const newData = record.data.map(q => {
            if (newRetryIds.has(q.id)) {
              return { ...q, userAnswer: undefined };
            }
            return q;
          });
          return { ...record, data: newData };
        }
        return record;
      })
    );
    
    setNavPage(0);
    alert(`이제 ${stillWrong.length}개의 틀린 문제를 다시 풀어봅니다.`);
  };

  const handleDownloadJSON = (e: React.MouseEvent, record: UploadedFileRecord) => {
    e.stopPropagation(); generateJSON(record.data, record.name);
  };

  const handleDownloadCSV = (e: React.MouseEvent, record: UploadedFileRecord) => {
    e.stopPropagation(); generateCSV(record.data);
  };
  
  const handleModeChange = (mode: 'LEARNING' | 'EXAM' | 'RANDOM') => {
    if (mode === currentMode) return;
    
    if (mode === 'EXAM' || mode === 'RANDOM') {
      const modeText = mode === 'EXAM' ? '시험' : '랜덤';
      if (answeredCount > 0 && !examSubmitted && !retryMode && !window.confirm(`${modeText} 모드로 전환하면 현재 문제 풀이 기록이 초기화됩니다. 계속하시겠습니까?`)) {
        return;
      }

      if (mode === 'RANDOM') {
        const selectedRecord = uploadedFiles.find(f => f.id === selectedUserRecordId);
        if (!selectedRecord) return;
        
        const targetSubject = getSubjectFromRecord(selectedRecord);
        const allQuestionsOfSubject = uploadedFiles
            .filter(f => getSubjectFromRecord(f) === targetSubject)
            .flatMap(f => f.data);

        const groupedByNumber = allQuestionsOfSubject.reduce((acc, q) => {
            const num = q.questionNumber;
            if (!acc[num]) acc[num] = [];
            acc[num].push(q);
            return acc;
        }, {} as Record<string, ParsedQuestion[]>);

        const newRandomQuestions = Object.values(groupedByNumber).map(questionGroup => {
            const randomIndex = Math.floor(Math.random() * questionGroup.length);
            return { ...questionGroup[randomIndex], userAnswer: undefined };
        });

        newRandomQuestions.sort((a, b) => parseInt(a.questionNumber) - parseInt(b.questionNumber));
        setRandomQuestions(newRandomQuestions);
      } else { // EXAM mode
        setUploadedFiles(prev => prev.map(record => record.id === selectedUserRecordId ? { ...record, data: record.data.map(q => ({ ...q, userAnswer: undefined })) } : record));
      }

      setExamSubmitted(false);
      setExamTimer(0);
      setNavPage(0);
    }
    setCurrentMode(mode);
  };


  React.useEffect(() => {
    if (appMode === 'USER' && currentMode === 'LEARNING' && selectedUserRecordId && totalCount > 0 && answeredCount === totalCount && !showScoreModal && !hasDismissedScore) {
      setShowScoreModal(true);
    }
  }, [answeredCount, totalCount, showScoreModal, hasDismissedScore, appMode, selectedUserRecordId, currentMode]);

  return (
    <div className={`min-h-screen pb-20 transition-all ${retryMode ? 'bg-orange-50' : 'bg-slate-50'}`}>
      <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.json" multiple onChange={handleDataImport} />

      <header className={`sticky top-0 z-[60] h-16 ${retryMode ? 'bg-orange-600 text-white shadow-xl' : 'bg-white/95 backdrop-blur-md text-slate-800 shadow-sm'}`}>
        <div className="max-w-5xl mx-auto px-4 h-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${retryMode ? 'bg-white text-orange-600' : 'bg-indigo-600 text-white'}`}>AI</div>
              <h1 className="text-xl font-black tracking-tighter hidden sm:block">ExamAI</h1>
              <div className="flex bg-slate-100 p-1 rounded-xl ml-2 md:ml-4">
                  <button onClick={() => { setAppMode('USER'); setSelectedUserRecordId(null); setAdminViewingRecordId(null); setNavPage(0); }} className={`px-3 md:px-4 py-1.5 rounded-lg text-xs font-black transition-all ${appMode === 'USER' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>사용자</button>
                  <button onClick={() => { setAppMode('ADMIN'); setAdminViewingRecordId(null); setNavPage(0); }} className={`px-3 md:px-4 py-1.5 rounded-lg text-xs font-black transition-all ${appMode === 'ADMIN' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>관리자</button>
              </div>
            </div>
            
            <div className="flex gap-2 items-center">
              {appMode === 'USER' && !activeRecordId && (
                <button onClick={() => setShowStatsModal(true)} className="px-3 md:px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] md:text-xs font-black hover:bg-indigo-100 transition-colors flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                  <span className="hidden sm:inline">학습 통계</span>
                </button>
              )}
            </div>
        </div>
      </header>

      {activeRecordId && (
         <div id="question-nav-bar" className="sticky top-16 bg-white/95 backdrop-blur-md p-2 md:p-4 border-b z-50">
          <div className="max-w-3xl mx-auto flex flex-col gap-y-4">
            {/* Controls Row */}
            <div className="flex items-center justify-center sm:justify-between flex-wrap gap-2">
                {/* Left/Center part: Mode toggle and timer */}
                <div className="flex items-center gap-2">
                   {appMode === 'USER' && !retryMode && (
                    <>
                      <div className="flex bg-slate-100 p-1 rounded-2xl">
                          <button onClick={() => handleModeChange('LEARNING')} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${currentMode === 'LEARNING' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>학습 모드</button>
                          <button onClick={() => handleModeChange('EXAM')} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${currentMode === 'EXAM' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>시험 모드</button>
                          <button onClick={() => handleModeChange('RANDOM')} className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${currentMode === 'RANDOM' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>랜덤 모드</button>
                      </div>
                      {(currentMode === 'EXAM' || currentMode === 'RANDOM') && !examSubmitted && (
                          <div className="hidden sm:flex items-center gap-2 bg-red-50 text-red-500 font-black px-3 py-2 rounded-full text-sm">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                              <span>{formatTime(examTimer)}</span>
                          </div>
                      )}
                    </>
                  )}
                </div>

                {/* Right part: Action Buttons */}
                <div className="flex items-center gap-2">
                  {appMode === 'USER' && (
                    <button onClick={() => setShowStatsModal(true)} className="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] md:text-xs font-black hover:bg-indigo-100 transition-colors flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                      <span className="hidden sm:inline">학습 통계</span>
                    </button>
                  )}
                  <button onClick={() => { setSelectedUserRecordId(null); setAdminViewingRecordId(null); setRetryMode(false); setExamSubmitted(false); setNavPage(0); }} className="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] md:text-xs font-black">목록</button>
                  {appMode === 'USER' && !retryMode && (currentMode === 'LEARNING' || examSubmitted) && 
                    <button onClick={startDojo} className="px-3 py-2 bg-orange-500 text-white rounded-xl text-[10px] md:text-xs font-black shadow-md">도장깨기</button>
                  }
                </div>
              </div>

            {/* Question Numbers Row */}
            <div className="flex items-center justify-between gap-2">
               <button onClick={() => setNavPage(Math.max(0, navPage - 1))} disabled={navPage === 0} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl bg-white border-2 border-slate-100 text-slate-400 disabled:opacity-30 hover:bg-slate-50 transition-all shrink-0">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7"/></svg>
               </button>
               <div className="flex gap-1 md:gap-2 overflow-x-auto no-scrollbar py-1">
                 {navItems.map((q) => {
                   const isAnswered = q.userAnswer !== undefined;
                   const isCorrect = q.userAnswer === q.correctAnswer;
                   const showAnswers = appMode === 'ADMIN' || (currentMode === 'LEARNING' && q.userAnswer !== undefined) || examSubmitted;
                   let colorClass = 'bg-white text-slate-400 border-slate-200';
                   if (isAnswered) {
                     if (showAnswers) colorClass = isCorrect ? 'bg-emerald-500 text-white border-emerald-600 shadow-md' : 'bg-red-500 text-white border-red-600 shadow-md';
                     else colorClass = 'bg-indigo-500 text-white border-indigo-600 shadow-md';
                   }
                   return (
                     <button key={q.id} onClick={() => scrollToQuestion(q.id)} className={`w-9 h-9 md:w-11 md:h-11 rounded-xl border-2 flex items-center justify-center font-black text-xs md:text-sm transition-all hover:scale-110 active:scale-95 shrink-0 ${colorClass}`}>
                       {q.questionNumber}
                     </button>
                   );
                 })}
               </div>
               <button onClick={() => setNavPage(navPage + 1)} disabled={(navPage + 1) * NAV_PAGE_SIZE >= currentQuestions.length} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl bg-white border-2 border-slate-100 text-slate-400 disabled:opacity-30 hover:bg-slate-50 transition-all shrink-0">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"/></svg>
               </button>
               <div className="hidden lg:flex items-center gap-4 text-right pr-4 border-l ml-4 pl-4">
                 <div className="flex flex-col">
                   <span className="text-[10px] font-bold text-slate-400 uppercase">진행</span>
                   <span className="text-sm font-black text-slate-800">{answeredCount}/{totalCount}</span>
                 </div>
                 {(appMode === 'USER' && (currentMode === 'LEARNING' || examSubmitted) && answeredCount > 0) && (
                   <div className="flex flex-col">
                     <span className="text-[10px] font-bold text-slate-400 uppercase">점수</span>
                     <span className={`text-sm font-black ${score >= 60 ? 'text-emerald-600' : 'text-red-500'}`}>{score}점</span>
                   </div>
                 )}
               </div>
            </div>
          </div>
         </div>
      )}

      <main className="max-w-5xl mx-auto px-4 mt-4 md:mt-12">
        {status === ProcessingStatus.PROCESSING ? (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="font-black text-slate-600 animate-pulse">데이터를 처리하고 있습니다...</p>
          </div>
        ) : (
          <>
            {appMode === 'USER' && !selectedUserRecordId && (
              <div className="animate-fade-in space-y-8">
                <section className="text-center py-8">
                    <h2 className="text-3xl font-black text-slate-900 mb-2">오늘의 기출문제 학습 📝</h2>
                    <p className="font-bold text-slate-400">학습할 시험지를 선택하거나 공유 받은 파일을 불러오세요.</p>
                </section>
                <div className="flex justify-center items-center gap-4 mb-8">
                  <button onClick={() => fileInputRef.current?.click()} className="px-6 py-3 bg-indigo-600 text-white rounded-full text-sm font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    CSV/JSON 불러오기
                  </button>
                  <button onClick={handleDeleteAllClick} className="px-6 py-3 bg-slate-100 text-slate-500 rounded-full text-sm font-black hover:bg-slate-200 transition-all flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    전체 삭제
                  </button>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="space-y-4 mb-8">
                    <div className="flex justify-center">
                      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-2 max-w-full">
                        <button onClick={() => setSelectedYearFilter('ALL')} className={`px-5 py-2.5 rounded-full text-xs font-black transition-all border whitespace-nowrap ${selectedYearFilter === 'ALL' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}>
                          전체 연도
                        </button>
                        {uniqueYears.map(year => (
                          <button key={year} onClick={() => setSelectedYearFilter(year)} className={`px-5 py-2.5 rounded-full text-xs font-black transition-all border whitespace-nowrap ${selectedYearFilter === year ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}>
                            {year}{year !== '기타' ? '년' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-2 max-w-full">
                        <button onClick={() => setSelectedSubjectFilter('ALL')} className={`px-5 py-2.5 rounded-full text-xs font-black transition-all border whitespace-nowrap ${selectedSubjectFilter === 'ALL' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-105' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}>
                          전체 과목
                        </button>
                        {uniqueSubjects.map(subject => (
                          <button key={subject} onClick={() => setSelectedSubjectFilter(subject)} className={`px-5 py-2.5 rounded-full text-xs font-black transition-all border whitespace-nowrap ${selectedSubjectFilter === subject ? 'bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-105' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300'}`}>
                            {subject}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {filteredFiles.length === 0 ? (
                    <div className="col-span-full py-24 text-center border-2 border-dashed rounded-[3rem] border-slate-200 bg-white shadow-sm">
                      <div className="text-6xl mb-4">📭</div>
                      <p className="font-black text-slate-300 whitespace-pre-line">
                        {uploadedFiles.length === 0 ? "업로드된 시험지가 없습니다.\n'CSV/JSON 불러오기'를 통해 데이터를 추가해주세요." : "해당 조건의 시험지가 없습니다."}
                      </p>
                    </div>
                  ) : (
                    filteredFiles.map(f => (
                      <div key={f.id} className="relative group">
                        <button onClick={() => {setSelectedUserRecordId(f.id); setCurrentMode('LEARNING'); setExamSubmitted(false);}} className="w-full bg-white p-8 rounded-[2.5rem] border-2 border-slate-50 shadow-lg text-left hover:border-indigo-600 hover:-translate-y-1 transition-all flex justify-between items-center">
                          <div className="flex-grow mr-4">
                            <div className="flex items-center gap-2 mb-2">
                               <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded text-center min-w-[3rem]">{getYearFromRecord(f)}{getYearFromRecord(f) !== '기타' ? '년' : ''}</span>
                               <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded text-center truncate">{getSubjectFromRecord(f)}</span>
                            </div>
                            <div className="text-xl font-black text-slate-800 group-hover:text-indigo-600 truncate mb-1">{f.name}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md uppercase">{f.questionCount} Questions</span>
                              {f.data.some(q => q.userAnswer !== undefined) && (<span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-md">풀이중</span>)}
                            </div>
                          </div>
                          <span className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black group-hover:bg-indigo-600 group-hover:text-white shrink-0 transition-all">→</span>
                        </button>
                        <button onClick={(e) => requestDelete(e, f.id)} className="absolute top-6 right-6 w-10 h-10 bg-red-50 text-red-400 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100 hover:text-red-600 z-10" title="시험지 삭제">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            {appMode === 'ADMIN' && !adminViewingRecordId && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-white rounded-[3rem] p-8 md:p-12 border shadow-2xl relative">
                  <div className="flex justify-between items-center mb-10">
                    <h2 className="text-2xl font-black text-slate-900">기출문제 데이터 구축</h2>
                    <div className="flex gap-2">
                      <button onClick={handleDownloadAllData} className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-black hover:bg-emerald-100 transition-colors flex items-center gap-1" title="현재 로드된 모든 시험지를 CSV로 다운로드합니다. 이 파일들을 public/data/ 폴더에 넣으면 배포 시 기본 데이터가 됩니다.">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                        전체 다운로드
                      </button>
                      {!defaultsCleared ? (
                        <button onClick={handleDeleteAllClick} className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-black hover:bg-red-100 transition-colors flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          전체 데이터 삭제
                        </button>
                      ) : (
                        <button onClick={handleRestoreDefaults} className="px-4 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-1" title="삭제된 기본 데이터를 다시 불러옵니다.">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                          기본 데이터 복구
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-10 w-fit mx-auto">
                    <button onClick={() => setInputMode('FILE')} className={`px-6 md:px-8 py-3 rounded-xl text-xs font-black transition-all ${inputMode === 'FILE' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>파일 분석</button>
                    <button onClick={() => setInputMode('TEXT')} className={`px-6 md:px-8 py-3 rounded-xl text-xs font-black transition-all ${inputMode === 'TEXT' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>텍스트 분석</button>
                    <button onClick={() => setInputMode('IMPORT')} className={`px-6 md:px-8 py-3 rounded-xl text-xs font-black transition-all ${inputMode === 'IMPORT' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>파일 불러오기</button>
                  </div>
                  <div className="space-y-8">
                    {inputMode === 'IMPORT' ? (
                      <div className="py-24 flex flex-col items-center border-2 border-dashed border-indigo-200 rounded-[2.5rem] bg-indigo-50/20 cursor-pointer hover:bg-indigo-50/40 transition-colors" onClick={() => fileInputRef.current?.click()}>
                        <div className="text-6xl mb-6">📁</div>
                        <p className="font-black text-indigo-400 text-lg mb-2">배포된 파일을 선택하세요</p>
                        <p className="text-xs font-bold text-indigo-300">지원 형식: JSON (배포용), CSV (백업용)</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {inputMode === 'FILE' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <Dropzone label="문제지 (필수)" onFilesSelected={(files) => processFiles(files).then(setQuestionFiles)} colorClass={questionFiles.length > 0 ? "border-indigo-600 bg-indigo-50 text-indigo-600" : "border-indigo-200 bg-slate-50 text-slate-400"}/>
                              {questionFiles.length > 0 && (
                                <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5 border border-indigo-100">
                                  <p className="text-[10px] font-black text-indigo-400 uppercase mb-1">선택된 문제지</p>
                                  {questionFiles.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-indigo-100 shadow-sm">
                                      <div className="flex items-center gap-2 overflow-hidden">
                                        <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
                                        <span className="text-xs font-bold text-slate-700 truncate">{f.file.name}</span>
                                      </div>
                                      <button onClick={() => setQuestionFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 transition-colors p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="space-y-3">
                              <Dropzone label="정답표 (선택)" colorClass={answerFiles.length > 0 ? "border-emerald-600 bg-emerald-50 text-emerald-600" : "border-emerald-200 bg-slate-50 text-slate-400"} onFilesSelected={(files) => processFiles(files).then(setAnswerFiles)} />
                              {answerFiles.length > 0 && (
                                <div className="bg-emerald-50 rounded-xl p-3 space-y-1.5 border border-emerald-100">
                                  <p className="text-[10px] font-black text-emerald-400 uppercase mb-1">선택된 정답표</p>
                                  {answerFiles.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-emerald-100 shadow-sm">
                                      <div className="flex items-center gap-2 overflow-hidden">
                                        <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
                                        <span className="text-xs font-bold text-slate-700 truncate">{f.file.name}</span>
                                      </div>
                                      <button onClick={() => setAnswerFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500 transition-colors p-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <textarea className="w-full h-64 p-8 border rounded-[2rem] bg-slate-50 font-bold focus:ring-4 ring-indigo-50 outline-none" placeholder="텍스트를 입력하세요..." value={rawTextInput} onChange={e => setRawTextInput(e.target.value)} />
                        )}
                        <button onClick={handleAnalyze} className="w-full py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-lg shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-50">AI 분석 및 저장</button>
                      </div>
                    )}
                  </div>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="bg-white p-10 rounded-[2.5rem] border shadow-lg">
                    <div className="flex justify-between items-center mb-8">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">기출문제 세트 관리</h3>
                      <button onClick={handleDeleteAllClick} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-lg text-[10px] font-bold hover:bg-red-100 transition-colors flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        목록 전체 삭제
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {uploadedFiles.map(f => (
                        <div key={f.id} className="p-4 bg-slate-50 border rounded-xl flex justify-between items-center group transition-all hover:bg-white hover:shadow-md relative overflow-hidden">
                          <span className="truncate text-xs font-bold text-slate-600 flex-grow mr-2 pointer-events-none">{f.name}</span>
                          <div className="flex items-center gap-1 z-10">
                            <button type="button" onClick={() => setAdminViewingRecordId(f.id)} className="w-8 h-8 flex items-center justify-center text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors" title="상세보기/수정"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
                            <button type="button" onClick={(e) => handleDownloadJSON(e, f)} className="w-8 h-8 flex items-center justify-center text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="배포용 파일 저장 (JSON)"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></button>
                            <button type="button" onClick={(e) => handleDownloadCSV(e, f)} className="w-8 h-8 flex items-center justify-center text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="CSV 내보내기"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></button>
                            <button type="button" onClick={(e) => requestDelete(e, f.id)} className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="영구 삭제"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeRecordId && (
              <div className="animate-fade-in space-y-10">
                {currentQuestions.map(q => (
                  <QuestionCard key={q.id} question={q} isAdmin={appMode === 'ADMIN'} onUpdate={handleUpdateQuestion} onDelete={(id) => setUploadedFiles(prev => prev.map(f => ({ ...f, data: f.data.filter(mq => mq.id !== id) })))} activeAudioInfo={activeAudioInfo} setActiveAudioInfo={setActiveAudioInfo} isExamMode={appMode === 'USER' && (currentMode === 'EXAM' || currentMode === 'RANDOM')} showAnswers={appMode === 'ADMIN' || (currentMode === 'LEARNING' && q.userAnswer !== undefined) || examSubmitted}/>
                ))}
                {appMode === 'USER' && (currentMode === 'EXAM' || currentMode === 'RANDOM') && !examSubmitted && (
                  <div className="mt-12 text-center">
                    <button onClick={handleExamSubmit} className="px-12 py-6 bg-indigo-600 text-white rounded-full font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">문제지 제출</button>
                  </div>
                )}
                {appMode === 'USER' && retryMode && answeredCount > 0 && answeredCount === totalCount && (
                  <div className="mt-12 text-center">
                    <button onClick={handleRetryDojo} className="px-12 py-6 bg-orange-600 text-white rounded-full font-black shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all">
                      다시 풀기
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {showStatsModal && <StatsModal data={uploadedFiles} onClose={() => setShowStatsModal(false)} />}
      {showExamResultModal && activeRecordId && <StatsModal data={uploadedFiles} onClose={() => setShowExamResultModal(false)} examRecordId={activeRecordId} questions={currentQuestions} onStartDojo={startDojo}/>}
      {recordToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100 transform transition-all scale-100">
             <div className="flex flex-col items-center text-center">
               <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6">
                 <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
               </div>
               <h3 className="text-xl font-black text-slate-800 mb-2">기출문제 세트 삭제</h3>
               <p className="text-slate-500 mb-8 break-keep font-medium text-sm">선택하신 시험지 세트를 정말로 삭제하시겠습니까?<br/>삭제된 학습 데이터는 복구할 수 없습니다.</p>
               <div className="flex gap-3 w-full">
                 <button onClick={() => setRecordToDelete(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-colors">취소</button>
                 <button onClick={confirmDeleteRecord} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-200">삭제하기</button>
               </div>
             </div>
          </div>
        </div>
      )}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-red-100 transform transition-all scale-100">
             <div className="flex flex-col items-center text-center">
               <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-6 border-4 border-red-100">
                 <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
               </div>
               <h3 className="text-2xl font-black text-slate-900 mb-2">모든 데이터 삭제</h3>
               <div className="text-slate-500 mb-8 break-keep font-medium text-sm bg-red-50 p-4 rounded-xl border border-red-100">
                 <p className="mb-2">현재 앱에 로드된 <strong className="text-red-600">{uploadedFiles.length}개</strong>의 시험지 데이터가 모두 초기화됩니다.</p>
                 <p className="text-xs text-red-400">서버의 원본 파일(CSV)은 삭제되지 않지만,<br/>'기본 데이터 복구'를 하기 전까지는 앱에 로드되지 않습니다.</p>
               </div>
               <div className="flex gap-3 w-full">
                 <button onClick={() => setShowDeleteAllModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-colors">취소</button>
                 <button onClick={confirmDeleteAll} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200">모두 삭제</button>
               </div>
             </div>
          </div>
        </div>
      )}
      {showScoreModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-6">
          <div className="bg-white rounded-[4rem] p-12 max-w-sm w-full text-center border relative shadow-2xl">
            <div className="text-9xl mb-8 animate-bounce">{feedback.emoji}</div>
            <h2 className={`text-3xl font-black mb-4 ${feedback.color}`}>{feedback.message}</h2>
            <div className={`text-[120px] font-black leading-none mb-10 ${feedback.color}`}>{score}점</div>
            <button onClick={() => { setShowScoreModal(false); setHasDismissedScore(true); }} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all">확인</button>
          </div>
        </div>
      )}
      <style>{`.animate-fade-in { animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; } @keyframes fadeIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } } .no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
};

export default App;
