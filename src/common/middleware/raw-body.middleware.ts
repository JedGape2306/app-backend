import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as bodyParser from 'body-parser';

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  use(
    req: Request & { rawBody?: Buffer },
    res: Response,
    next: NextFunction,
  ) {
    bodyParser.json({
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        if (Buffer.isBuffer(buf)) {
          req.rawBody = buf;
        }
      },
    })(req, res, next);
  }
}