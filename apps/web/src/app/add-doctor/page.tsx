'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import DashboardLayout from '@/components/dashboard-layout';
import ScenarioControls from '@/components/scenario-controls';
import { useUserStore } from '@/hooks/use-user-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const doctorSchema = z.object({
  name: z.string().min(2, 'Укажите имя врача'),
  email: z.string().email('Введите корректный email'),
  specialty: z.string().min(1, 'Выберите специальность'),
  password: z.string().min(6, 'Минимум 6 символов'),
});

type DoctorFormValues = z.infer<typeof doctorSchema>;

export default function AddDoctorPage() {
  const { currentUser, addUser, isInitialized } = useUserStore();
  const { toast } = useToast();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isInitialized) {
      if (!currentUser) {
        router.push('/login');
      } else if (currentUser.role !== 'admin') {
        toast({
          variant: 'destructive',
          title: 'Нет доступа',
          description: 'Добавлять врачей может только администратор.',
        });
        router.push('/');
      }
    }
  }, [currentUser, router, toast, isInitialized]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DoctorFormValues>({
    resolver: zodResolver(doctorSchema),
  });

  const onSubmit: SubmitHandler<DoctorFormValues> = async (data) => {
    setIsLoading(true);
    try {
      await addUser({
        id: '',
        role: 'doctor',
        name: data.name,
        email: data.email,
        specialty: data.specialty,
        password: data.password,
      });
      toast({ title: 'Врач добавлен', description: `${data.name} успешно добавлен в систему.` });
      router.push('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось добавить врача';
      toast({ variant: 'destructive', title: 'Ошибка', description: msg });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isInitialized || !currentUser || currentUser.role !== 'admin') {
    return (
      <DashboardLayout sidebarContent={<ScenarioControls onScenarioGenerated={() => {}} />}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout sidebarContent={<ScenarioControls onScenarioGenerated={() => {}} />}>
      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold text-primary font-headline">Добавить врача</h1>
        </header>
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Данные врача</CardTitle>
            <CardDescription>Заполните информацию о новом враче.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="name">ФИО врача</Label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-destructive text-sm mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-destructive text-sm mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="specialty">Специальность</Label>
                <Select onValueChange={(value) => setValue('specialty', value, { shouldValidate: true })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите специальность" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Кардиология">Кардиология</SelectItem>
                    <SelectItem value="Неврология">Неврология</SelectItem>
                    <SelectItem value="Педиатрия">Педиатрия</SelectItem>
                    <SelectItem value="Общая практика">Общая практика</SelectItem>
                  </SelectContent>
                </Select>
                {errors.specialty && <p className="text-destructive text-sm mt-1">{errors.specialty.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">Временный пароль</Label>
                <PasswordInput id="password" {...register('password')} />
                {errors.password && <p className="text-destructive text-sm mt-1">{errors.password.message}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Добавить врача
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </DashboardLayout>
  );
}
