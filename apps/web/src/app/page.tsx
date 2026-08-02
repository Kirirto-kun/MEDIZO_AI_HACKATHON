'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  ShieldAlert,
  Star,
  Search,
  PenSquare,
  Inbox,
  FilePlus2,
} from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import ScenarioControls from '@/components/scenario-controls';
import {
  Card,
  CardDescription,
  CardTitle,
  CardFooter,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUserStore } from '@/hooks/use-user-store';
import { usePatientStore } from '@/hooks/use-patient-store';

export default function Home() {
  const { currentUser, isInitialized: userIsInitialized, allUsers } = useUserStore();
  const { activePatient } = usePatientStore();
  const router = useRouter();
  const t = useTranslations('home');

  // The dashboard needs only the authenticated profile. Case-catalog data is
  // secondary and must not trap the whole app behind a spinner on a slow or
  // interrupted mobile connection.
  const isLoading = !userIsInitialized;

  useEffect(() => {
    if (!isLoading && !currentUser) {
      router.push('/login');
    }
  }, [currentUser, isLoading, router]);

  const MainContent = () => {
    if (isLoading) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      );
    }

    if (!currentUser) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      );
    }

    if (currentUser.role === 'doctor') {
      const legacyCaseId = activePatient?.id;
      const legacySubgroup = activePatient?.subgroup;
      return (
        <Card className="m-auto flex w-full min-w-0 max-w-lg flex-col items-center justify-center bg-card/80 p-6 text-center animate-fade-in sm:p-12">
          <ShieldAlert className="h-12 w-12 text-accent mb-4" />
          <CardTitle className="text-2xl font-headline">{t('doctor.title')}</CardTitle>
          <CardDescription className="mt-2 max-w-md">
            {t('doctor.description')}
          </CardDescription>
          <CardFooter className="mt-6 flex flex-col gap-3 w-full max-w-xs">
            <Button className="h-auto min-h-10 w-full whitespace-normal py-2" onClick={() => router.push('/select-subgroup')}>
              {t('doctor.selectSubgroup')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/saved-cases')}
            >
              <Star className="mr-2 h-4 w-4" />
              {t('doctor.savedCases')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/ai-search')}
            >
              <Search className="mr-2 h-4 w-4" />
              {t('doctor.aiSearch')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/suggest-case')}
            >
              <FilePlus2 className="mr-2 h-4 w-4" />
              {t('doctor.suggestCase')}
            </Button>
            {legacyCaseId && legacySubgroup ? (
              <Button
                variant="ghost"
                className="h-auto min-h-10 w-full whitespace-normal py-2"
                onClick={() => router.push(`/cases/${legacySubgroup}/${legacyCaseId}`)}
              >
                {t('doctor.continueCase', { name: activePatient?.name ?? '' })}
              </Button>
            ) : null}
          </CardFooter>
        </Card>
      );
    }

    if (currentUser.role === 'reviewer') {
      return (
        <Card className="m-auto flex w-full min-w-0 max-w-lg flex-col items-center justify-center bg-card/80 p-6 text-center animate-fade-in sm:p-12">
          <PenSquare className="h-12 w-12 text-accent mb-4" />
          <CardTitle className="text-2xl font-headline">{t('reviewer.title')}</CardTitle>
          <CardDescription className="mt-2 max-w-md">
            {t('reviewer.description')}
          </CardDescription>
          <CardFooter className="mt-6 flex flex-col gap-3 w-full max-w-xs">
            <Button className="h-auto min-h-10 w-full whitespace-normal py-2" onClick={() => router.push('/select-subgroup')}>
              {t('reviewer.selectSubgroup')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/saved-cases')}
            >
              <Star className="mr-2 h-4 w-4" />
              {t('reviewer.savedCases')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/reviewer/my-reviews')}
            >
              <PenSquare className="mr-2 h-4 w-4" />
              {t('reviewer.myReviews')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/ai-search')}
            >
              <Search className="mr-2 h-4 w-4" />
              {t('reviewer.aiSearch')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/suggest-case')}
            >
              <FilePlus2 className="mr-2 h-4 w-4" />
              {t('reviewer.suggestCase')}
            </Button>
          </CardFooter>
        </Card>
      );
    }

    if (currentUser.role === 'admin') {
      const doctorCount = allUsers.filter((u) => u.role === 'doctor').length;
      const reviewerCount = allUsers.filter((u) => u.role === 'reviewer').length;
      return (
        <Card className="m-auto flex w-full min-w-0 max-w-lg flex-col items-center justify-center bg-card/80 p-6 text-center animate-fade-in sm:p-12">
          <CardTitle className="text-2xl font-headline">{t('admin.welcome')}</CardTitle>
          <CardDescription className="mt-2">{t('admin.description')}</CardDescription>
          <CardContent className="mt-6 text-left">
            <p className="text-lg">{t('admin.systemState')}</p>
            <ul className="list-disc list-inside mt-2 text-muted-foreground">
              <li>{t('admin.doctorCount', { count: doctorCount })}</li>
              <li>{t('admin.reviewerCount', { count: reviewerCount })}</li>
            </ul>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 w-full max-w-xs">
            <Button className="h-auto min-h-10 w-full whitespace-normal py-2" onClick={() => router.push('/add-doctor')}>
              {t('admin.addDoctor')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/ai-search')}
            >
              <Search className="mr-2 h-4 w-4" />
              {t('admin.aiSearch')}
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-10 w-full whitespace-normal py-2"
              onClick={() => router.push('/admin/case-submissions')}
            >
              <Inbox className="mr-2 h-4 w-4" />
              {t('admin.caseSubmissions')}
            </Button>
          </CardFooter>
        </Card>
      );
    }

    return (
      <Card className="m-auto flex w-full min-w-0 max-w-lg flex-col items-center justify-center bg-card/80 p-6 text-center animate-fade-in sm:p-12">
        <CardTitle className="text-2xl font-headline">
          {t('fallback.welcome', { name: currentUser.name })}
        </CardTitle>
        <CardDescription className="mt-2">{t('fallback.description')}</CardDescription>
      </Card>
    );
  };

  return (
    <DashboardLayout
      sidebarContent={<ScenarioControls onScenarioGenerated={() => {}} />}
    >
      <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-y-auto p-4 md:p-6 lg:p-8">
        <MainContent />
      </main>
    </DashboardLayout>
  );
}
