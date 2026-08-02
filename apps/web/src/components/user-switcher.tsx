'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/hooks/use-user-store';
import { useTranslations } from 'next-intl';
import { ChevronsUpDown, LogOut, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function UserSwitcher() {
  const { currentUser, logout } = useUserStore();
  const router = useRouter();
  const t = useTranslations('nav.userMenu');

  const handleLogout = async () => {
    await logout();
    // If the logout request timed out, the HttpOnly refresh cookie may still
    // exist. A plain login navigation would auto-restore that same session.
    window.location.replace('/login?skipRestore=1');
  };

  if (!currentUser) {
    return null;
  }

  const ROLE_KEY: Record<string, 'rolesAdmin' | 'rolesDoctor' | 'rolesReviewer' | 'rolesPatient'> = {
    admin: 'rolesAdmin',
    doctor: 'rolesDoctor',
    reviewer: 'rolesReviewer',
    patient: 'rolesPatient',
  };

  const roleLabel =
    currentUser.role === 'doctor' && currentUser.specialty
      ? currentUser.specialty
      : ROLE_KEY[currentUser.role]
        ? t(ROLE_KEY[currentUser.role])
        : currentUser.role;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between h-auto py-2 px-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:size-12 group-data-[collapsible=icon]:p-0"
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={currentUser.profilePhotoUrl ?? undefined} alt={currentUser.name} />
              <AvatarFallback>{currentUser.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="text-left group-data-[collapsible=icon]:hidden">
              <p className="font-medium text-sm truncate">{currentUser.name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <DropdownMenuLabel>{t('loggedInAs', { name: currentUser.name })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          <UserIcon className="mr-2 h-4 w-4" />
          <span>{t('profile')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t('logout')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
