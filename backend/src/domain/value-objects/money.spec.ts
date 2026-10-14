import { describe, it, expect } from "bun:test";
import { Money, InvalidMoneyError, CurrencyMismatchError } from "./money";

describe("Money", () => {
  describe("from()", () => {
    it("should create Money from valid props", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });
      expect(money.getAmount()).toBe("100.00");
      expect(money.currency).toBe("BRL");
    });

    it("should accept integer amounts", () => {
      const money = Money.from({ amount: "100", currency: "BRL" });
      expect(money.getAmount()).toBe("100.00");
    });

    it("should accept one decimal place", () => {
      const money = Money.from({ amount: "100.5", currency: "BRL" });
      expect(money.getAmount()).toBe("100.50");
    });

    it("should uppercase currency", () => {
      const money = Money.from({ amount: "100.00", currency: "brl" });
      expect(money.currency).toBe("BRL");
    });

    it("should reject empty amount", () => {
      expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject null amount", () => {
      expect(() =>
        Money.from({ amount: null as any, currency: "BRL" }),
      ).toThrow(InvalidMoneyError);
    });

    it("should reject negative amount", () => {
      expect(() => Money.from({ amount: "-100.00", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject more than 2 decimal places", () => {
      expect(() => Money.from({ amount: "100.001", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject scientific notation", () => {
      expect(() => Money.from({ amount: "1e10", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject NaN string", () => {
      expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(
        InvalidMoneyError,
      );
    });

    it("should reject invalid currency format", () => {
      expect(() => Money.from({ amount: "100.00", currency: "BR" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100.00", currency: "BRLX" })).toThrow(
        InvalidMoneyError,
      );
      expect(() => Money.from({ amount: "100.00", currency: "" })).toThrow(
        InvalidMoneyError,
      );
    });
  });

  describe("zero()", () => {
    it("should create zero Money", () => {
      const money = Money.zero("BRL");
      expect(money.getAmount()).toBe("0.00");
      expect(money.currency).toBe("BRL");
      expect(money.isZero()).toBe(true);
    });
  });

  describe("arithmetic operations", () => {
    it("should add two Money values", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "50.00", currency: "BRL" });
      const result = a.add(b);
      expect(result.getAmount()).toBe("150.00");
    });

    it("should subtract two Money values", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "30.00", currency: "BRL" });
      const result = a.subtract(b);
      expect(result.getAmount()).toBe("70.00");
    });

    it("should negate Money value", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });
      const negated = money.negate();
      expect(negated.getAmount()).toBe("-100.00");
    });

    it("should throw on currency mismatch for add", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const usd = Money.from({ amount: "100.00", currency: "USD" });
      expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    });

    it("should throw on currency mismatch for subtract", () => {
      const brl = Money.from({ amount: "100.00", currency: "BRL" });
      const usd = Money.from({ amount: "100.00", currency: "USD" });
      expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe("comparison operations", () => {
    it("should check if positive", () => {
      expect(
        Money.from({ amount: "100.00", currency: "BRL" }).isPositive(),
      ).toBe(true);
      expect(Money.from({ amount: "0.00", currency: "BRL" }).isPositive()).toBe(
        false,
      );
    });

    it("should check if zero", () => {
      expect(Money.from({ amount: "0.00", currency: "BRL" }).isZero()).toBe(
        true,
      );
      expect(Money.from({ amount: "100.00", currency: "BRL" }).isZero()).toBe(
        false,
      );
    });

    it("should check if negative", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });
      expect(money.isNegative()).toBe(false);
      expect(money.negate().isNegative()).toBe(true);
    });

    it("should compare with isLessThan", () => {
      const a = Money.from({ amount: "50.00", currency: "BRL" });
      const b = Money.from({ amount: "100.00", currency: "BRL" });
      expect(a.isLessThan(b)).toBe(true);
      expect(b.isLessThan(a)).toBe(false);
    });

    it("should compare with equals", () => {
      const a = Money.from({ amount: "100.00", currency: "BRL" });
      const b = Money.from({ amount: "100.00", currency: "BRL" });
      const c = Money.from({ amount: "100.00", currency: "USD" });
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });

  describe("immutability", () => {
    it("should not modify original on add", () => {
      const original = Money.from({ amount: "100.00", currency: "BRL" });
      const other = Money.from({ amount: "50.00", currency: "BRL" });
      original.add(other);
      expect(original.getAmount()).toBe("100.00");
    });

    it("should not modify original on subtract", () => {
      const original = Money.from({ amount: "100.00", currency: "BRL" });
      const other = Money.from({ amount: "50.00", currency: "BRL" });
      original.subtract(other);
      expect(original.getAmount()).toBe("100.00");
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });
      const json = money.toJSON();
      expect(json).toEqual({ amount: "100.00", currency: "BRL" });
    });

    it("should convert to string", () => {
      const money = Money.from({ amount: "100.00", currency: "BRL" });
      expect(money.toString()).toBe("100.00 BRL");
    });
  });
});
