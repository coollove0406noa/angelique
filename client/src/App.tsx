import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminAuthProvider, useAdminAuth } from "./contexts/AdminAuthContext";
import { BrandProvider } from "./contexts/BrandContext";
import Home from "./pages/Home";
import AdminDashboard from "./pages/AdminDashboard";
import AdminBookings from "./pages/AdminBookings";
import AdminSession from "./pages/AdminSession";
import AdminSettings from "./pages/AdminSettings";
import AdminClients from "./pages/AdminClients";
import AdminSessionDetail from "./pages/AdminSessionDetail";
import ClientSession from "./pages/ClientSession";
import SuperAdminLogin from "./pages/SuperAdminLogin";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import { FaviconManager } from "./components/FaviconManager";

// Wrapper that provides BrandContext for admin pages
function AdminBrandWrapper({ children }: { children: React.ReactNode }) {
  const { fortuneTeller } = useAdminAuth();
  return (
    <BrandProvider
      brandName={fortuneTeller?.brandName ?? "angelique"}
      themeColor={fortuneTeller?.themeColor ?? "dusty-pink"}
    >
      {children}
    </BrandProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />

      {/* Super admin */}
      <Route path="/super-admin" component={SuperAdminDashboard} />
      <Route path="/super-admin/login" component={SuperAdminLogin} />

      {/* Backward compat: /admin → /admin/noa */}
      <Route path="/admin">
        <Redirect to="/admin/noa" />
      </Route>
      <Route path="/admin/bookings">
        <Redirect to="/admin/noa/bookings" />
      </Route>
      <Route path="/admin/settings">
        <Redirect to="/admin/noa/settings" />
      </Route>
      <Route path="/admin/session/:id">
        {(params) => <Redirect to={`/admin/noa/session/${params.id}`} />}
      </Route>

      {/* Per-fortune-teller admin routes */}
      <Route path="/admin/:slug" component={AdminDashboard} />
      <Route path="/admin/:slug/bookings" component={AdminBookings} />
      <Route path="/admin/:slug/session/:id" component={AdminSession} />
      <Route path="/admin/:slug/settings" component={AdminSettings} />
      <Route path="/admin/:slug/clients" component={AdminClients} />
      <Route path="/admin/:slug/clients/:clientId" component={AdminSessionDetail} />

      {/* Customer-facing session */}
      <Route path="/session/:token" component={ClientSession} />

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <FaviconManager />
          <AdminAuthProvider>
            <AdminBrandWrapper>
              <Router />
            </AdminBrandWrapper>
          </AdminAuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
