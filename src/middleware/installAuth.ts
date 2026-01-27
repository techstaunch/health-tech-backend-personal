import { NextFunction, Request, Response } from "express";

export function installAuth(_req: Request, _res: Response, next: NextFunction) {
  // Add your authentication logic here
  next();
}

export default installAuth;
