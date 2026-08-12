import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, type State } from '@/lib/api';

interface AppCtx {
  state: State | null;
  loading: boolean;
  refresh: () => Promise<void>;
  toast: (msg: string, type?: 'ok' | 'err') => void;
}

const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.state();
    setState(s);
    setLoading(false);
  }, []);

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToastMsg({ msg, type });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  return (
    <Ctx.Provider value={{ state, loading, refresh, toast }}>
      {children}
      {toastMsg && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] rounded-full px-5 py-2.5 text-sm text-white shadow-lg ${toastMsg.type === 'err' ? 'bg-destructive' : 'bg-foreground'}`}>
          {toastMsg.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
