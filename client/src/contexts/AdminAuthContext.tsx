import { createContext, useContext, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  refetch: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  refetch: () => {},
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = trpc.admin.check.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated: data?.authenticated ?? false,
        isLoading,
        refetch,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
