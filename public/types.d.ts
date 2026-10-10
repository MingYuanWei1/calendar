interface SchoolEvent {
  id: string;
  version?: number;
  title: string[];
  type: string;
  start: string;
  end?: string;
  time?: string;
  endTime?: string;
  timeMode?: string;
  scope: string[];
  grades?: number[];
  personal?: boolean;
  examBatch?: string;
  note?: string;
  location?: string[];
  host?: string[];
  description?: string[];
  extra?: string[];
  status?: 'draft' | 'published' | 'cancelled';
  cancelled?: boolean;
  cancelReason?: string;
  registration?: boolean;
  registrationUrl?: string;
  poster?: string;
  qr?: string;
  oldDate?: string;
  previousSchedule?: {start:string; end?:string; time?:string; endTime?:string; type:string};
  updatedAt?: string;
  repeat?: RepeatRule;
  exceptions?: Record<string, Record<string, any>>;
  seriesId?: string;
  occurrence?: string;
  cancelledOnce?: boolean;
}
interface RepeatRule {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  schoolDays?: boolean;
  weekdays?: number[];
  monthDays?: number[];
  ordinal?: number;
  weekday?: number;
  until?: string;
  count?: number;
}
