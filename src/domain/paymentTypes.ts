export type PaymentStatus =
  | "CREATED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export interface Payment {
  id: string;
  usdAmount: number;
  destinationCurrency: string; 
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

