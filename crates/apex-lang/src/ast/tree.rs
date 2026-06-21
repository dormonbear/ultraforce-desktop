//! Typed Apex AST nodes (Phase 1). Type references are kept as source text for
//! now; the Phase-2 type model resolves them. Every node carries a byte [`Span`].

/// A byte span `[start, end)` into the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// A parsed source file: its top-level type declarations.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CompilationUnit {
    pub types: Vec<TypeDecl>,
    /// Recoverable parse errors (the tree is still usable).
    pub errors: Vec<ParseError>,
}

/// A parse error with the span it was detected at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub span: Span,
}

/// class / interface / enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeKind {
    Class,
    Interface,
    Enum,
}

/// A type declaration (top-level or nested).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDecl {
    pub kind: TypeKind,
    pub annotations: Vec<String>,
    pub modifiers: Vec<String>,
    pub name: String,
    pub extends: Option<String>,
    pub implements: Vec<String>,
    pub members: Vec<Member>,
    /// enum constant names (empty for class/interface).
    pub enum_constants: Vec<String>,
    pub span: Span,
}

/// A member of a type declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Member {
    Field(FieldDecl),
    Method(MethodDecl),
    Property(PropertyDecl),
    Nested(TypeDecl),
}

/// A field declaration (`modifiers type name [= …];`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDecl {
    pub modifiers: Vec<String>,
    pub annotations: Vec<String>,
    pub ty: String,
    pub name: String,
    pub span: Span,
}

/// A method or constructor declaration. `return_type` is `None` for a
/// constructor (and `void` is kept as the text `"void"`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MethodDecl {
    pub modifiers: Vec<String>,
    pub annotations: Vec<String>,
    pub return_type: Option<String>,
    pub name: String,
    pub params: Vec<Param>,
    /// The parsed method body, or `None` for an interface/abstract method.
    pub body: Option<Block>,
    pub span: Span,
}

/// A property declaration (`modifiers type name { get; set; }`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyDecl {
    pub modifiers: Vec<String>,
    pub annotations: Vec<String>,
    pub ty: String,
    pub name: String,
    pub span: Span,
}

/// A method/constructor parameter (`type name`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Param {
    pub ty: String,
    pub name: String,
}

/// A `{ … }` block of statements.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Block {
    pub stmts: Vec<Stmt>,
    pub span: Span,
}

/// A statement inside a method body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stmt {
    /// `Type a = e, b;`
    LocalVar {
        ty: String,
        decls: Vec<(String, Option<Expr>)>,
        span: Span,
    },
    /// A bare expression statement (`foo();`, `x = 1;`).
    Expr(Expr),
    If {
        cond: Expr,
        then: Box<Stmt>,
        els: Option<Box<Stmt>>,
        span: Span,
    },
    /// C-style `for (init; cond; update) body`.
    For {
        init: Option<Box<Stmt>>,
        cond: Option<Expr>,
        update: Option<Expr>,
        body: Box<Stmt>,
        span: Span,
    },
    /// `for (Type x : iterable) body`.
    ForEach {
        ty: String,
        name: String,
        iter: Expr,
        body: Box<Stmt>,
        span: Span,
    },
    While {
        cond: Expr,
        body: Box<Stmt>,
        span: Span,
    },
    DoWhile {
        body: Box<Stmt>,
        cond: Expr,
        span: Span,
    },
    Return(Option<Expr>, Span),
    Throw(Expr, Span),
    Break(Span),
    Continue(Span),
    Try {
        block: Block,
        catches: Vec<Catch>,
        finally: Option<Block>,
        span: Span,
    },
    Block(Block),
    /// DML statement (`insert acc;`, `update list;`, …).
    Dml {
        op: String,
        expr: Expr,
        span: Span,
    },
    /// A stray `;`.
    Empty(Span),
}

/// A `catch (Type name) { … }` clause.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Catch {
    pub ty: String,
    pub name: String,
    pub block: Block,
}

/// Literal flavor for [`Expr::Lit`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LitKind {
    Int,
    Long,
    Decimal,
    Str,
    Bool,
    Null,
}

/// An expression. Type references inside casts/`new` stay as source text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expr {
    Lit(LitKind, Span),
    Name(String, Span),
    This(Span),
    Super(Span),
    Unary {
        op: String,
        /// true for prefix (`!x`, `++x`), false for postfix (`x++`).
        prefix: bool,
        operand: Box<Expr>,
        span: Span,
    },
    Binary {
        op: String,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
        span: Span,
    },
    Assign {
        op: String,
        target: Box<Expr>,
        value: Box<Expr>,
        span: Span,
    },
    Ternary {
        cond: Box<Expr>,
        then: Box<Expr>,
        els: Box<Expr>,
        span: Span,
    },
    /// `target.name`
    Member {
        target: Box<Expr>,
        name: String,
        span: Span,
    },
    /// `callee(args)`
    Call {
        callee: Box<Expr>,
        args: Vec<Expr>,
        span: Span,
    },
    /// `target[index]`
    Index {
        target: Box<Expr>,
        index: Box<Expr>,
        span: Span,
    },
    /// `new Type(args)` / `new Type[...]{...}` (collection/map inits parsed as args best-effort).
    New {
        ty: String,
        args: Vec<Expr>,
        span: Span,
    },
    /// `(Type) expr`
    Cast {
        ty: String,
        expr: Box<Expr>,
        span: Span,
    },
    Paren(Box<Expr>, Span),
    /// A region that failed to parse (recovery).
    Error(Span),
}

impl Expr {
    /// The byte span this expression covers.
    pub fn span(&self) -> Span {
        match self {
            Expr::Lit(_, s)
            | Expr::Name(_, s)
            | Expr::This(s)
            | Expr::Super(s)
            | Expr::Paren(_, s)
            | Expr::Error(s) => *s,
            Expr::Unary { span, .. }
            | Expr::Binary { span, .. }
            | Expr::Assign { span, .. }
            | Expr::Ternary { span, .. }
            | Expr::Member { span, .. }
            | Expr::Call { span, .. }
            | Expr::Index { span, .. }
            | Expr::New { span, .. }
            | Expr::Cast { span, .. } => *span,
        }
    }
}
