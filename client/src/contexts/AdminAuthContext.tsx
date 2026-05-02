import { createContext, useContext } from "react";
import { trpc } from "@/lib/trpc";

export interface FortuneTellerInfo {
  fortuneTellerId: number;
  slug: string;
  brandName: string;
  themeColor: string;
  accentColor: string;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  fortuneTeller: FortuneTellerInfo | null;
  refetch: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  fortuneTeller: null,
  refetch: () => {},
});

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, refetch } = trpc.admin.check.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const fortuneTeller: FortuneTellerInfo | null =
    data?.authenticated && data.fortuneTellerId
      ? {
          fortuneTellerId: data.fortuneTellerId,
          slug: data.slug!,
          brandName: data.brandName!,
          themeColor: data.themeColor!,
          accentColor: data.accentColor ?? "#c9a8a3",
        }
      : null;

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated: data?.authenticated ?? false,
        isLoading,
        fortuneTeller,
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
