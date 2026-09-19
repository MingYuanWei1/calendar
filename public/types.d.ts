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
}
