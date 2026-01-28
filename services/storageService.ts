import { UploadedFileRecord } from '../types';

const STORAGE_KEY = 'exam_ai_uploaded_files_v3';
const DEFAULTS_CLEARED_KEY = 'exam_ai_defaults_cleared';

// 브라우저에서 localStorage를 사용할 수 있는지 확인하는 기능
const isLocalStorageAvailable = (): boolean => {
  let storage;
  try {
    storage = window.localStorage;
    const x = '__storage_test__';
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return (
      e instanceof DOMException &&
      (e.code === 22 ||
        e.code === 1014 ||
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
      storage &&
      storage.length !== 0
    );
  }
};

const storageAvailable = isLocalStorageAvailable();

// --- 기출문제 데이터 관리 ---
export const loadUploadedFiles = (): UploadedFileRecord[] => {
  if (!storageAvailable) {
    console.warn('LocalStorage is not available. Cannot load data.');
    return [];
  }
  const savedData = localStorage.getItem(STORAGE_KEY);
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse saved data from localStorage', e);
    }
  }
  return [];
};

export const saveUploadedFiles = (files: UploadedFileRecord[]): boolean => {
  if (!storageAvailable) {
    console.warn('LocalStorage is not available. Cannot save data.');
    alert('오류: 브라우저 저장 공간을 사용할 수 없습니다. 데이터가 저장되지 않을 수 있습니다. (시크릿 모드 또는 저장 공간 부족)');
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    return true;
  } catch (e) {
    console.error('Failed to save data to localStorage', e);
    alert('데이터 저장에 실패했습니다. 브라우저 저장 공간이 가득 찼을 수 있습니다.');
    return false;
  }
};

export const clearUploadedFiles = (): void => {
    if (storageAvailable) {
        localStorage.removeItem(STORAGE_KEY);
    }
}

// --- 기본 데이터 삭제 플래그 관리 ---
export const getDefaultsClearedFlag = (): boolean => {
  if (!storageAvailable) return false;
  return localStorage.getItem(DEFAULTS_CLEARED_KEY) === 'true';
};

export const setDefaultsClearedFlag = (): void => {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(DEFAULTS_CLEARED_KEY, 'true');
  } catch (e) {
    console.error('Failed to set defaults cleared flag', e);
  }
};

export const removeDefaultsClearedFlag = (): void => {
  if (!storageAvailable) return;
  localStorage.removeItem(DEFAULTS_CLEARED_KEY);
};
