import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): { status: string; service: string } {
    return { status: 'ok', service: 'havit-api' };
  }
}
