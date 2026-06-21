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
    /// The method body span (`{ … }`), or `None` for an interface/abstract method.
    pub body: Option<Span>,
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
