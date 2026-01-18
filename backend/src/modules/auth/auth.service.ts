import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  issueToken(userId: string) {
    const token = this.jwtService.sign({ sub: userId });
    return { accessToken: token };
  }
}
