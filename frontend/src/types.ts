export interface User {
  uid: string;
  email: string;
  role: "clinician" | "admin";
}
