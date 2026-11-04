import { AppProvider } from './AppContext';
import { AppLayout } from '../layouts/AppLayout';

export function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
