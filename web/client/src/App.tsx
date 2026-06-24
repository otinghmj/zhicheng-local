import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { DirectoryPicker } from './components/DirectoryPicker';
import { Dashboard } from './pages/Dashboard';
import { CV } from './pages/CV';
import { InterviewPrep } from './pages/InterviewPrep';
import { Pipeline } from './pages/Pipeline';
import { Reports } from './pages/Reports';
import { Scan } from './pages/Scan';
import { Tracker } from './pages/Tracker';

const ThemeCheck = lazy(() => import('./theme-check/ThemeCheck'));

export function App() {
  return (
    <Routes>
      <Route element={<DirectoryPicker><AppLayout /></DirectoryPicker>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/collection" element={<Scan />} />
        <Route path="/resumes" element={<CV />} />
        <Route path="/applications" element={<Tracker />} />
        <Route path="/interview-prep" element={<InterviewPrep />} />
      </Route>
      <Route
        path="/theme-check"
        element={
          <Suspense fallback={<main>正在加载主题对照页...</main>}>
            <ThemeCheck />
          </Suspense>
        }
      />
    </Routes>
  );
}
