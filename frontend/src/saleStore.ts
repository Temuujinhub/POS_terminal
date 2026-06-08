// Shared sale flow state (in-memory, simple ref-based store)
type SaleState = {
  pumpId?: string;
  pumpNumber?: number;
  fuelType?: string;
  pricePerLiter?: number;
  liters?: number;
  amount?: number;
  paymentMethod?: "cash" | "card" | "membership";
  membershipCard?: string;
  membershipHolder?: string;
  membershipBalance?: number;
  customerType?: "individual" | "organization";
  registerNumber?: string;
  customerName?: string;
};

let state: SaleState = {};

export const saleStore = {
  get: () => state,
  set: (patch: Partial<SaleState>) => {
    state = { ...state, ...patch };
  },
  reset: () => {
    state = {};
  },
};
